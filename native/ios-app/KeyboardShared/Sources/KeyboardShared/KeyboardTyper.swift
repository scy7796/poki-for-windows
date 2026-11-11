import Foundation

/// The text field as the keyboard reaches it (`UITextDocumentProxy` on the phone, a fake in tests).
@MainActor
protocol KeyboardDocument: AnyObject {
    var contextBefore: String? { get }
    var contextAfter: String? { get }
    var selectedText: String? { get }
    var documentID: UUID { get }
    func insert(_ text: String)
    func deleteBackward()
    func moveCursor(by offset: Int)
    /// The composition under the cursor, as an input method shows the letters typed so far; "" ends
    /// it with nothing left in the field.
    func setMarked(_ text: String)
}

/// How a text is typed: what goes in with each keyboard insertion, and the pause before it.
enum KeyboardTyper {
    struct Step: Equatable {
        enum Kind: Equatable {
            /// Goes into the field as it is.
            case insert
            /// The Pinyin letters typed so far for the word that follows, shown as the composition.
            case compose
            /// The word that replaces the composition, as when a candidate is picked.
            case commit
        }
        /// What one insertion carries; "\u{8}" is one Delete.
        var text: String
        /// Seconds waited before it.
        var pause: Double
        var kind = Kind.insert
        /// Characters of the request this step puts in.
        var count: Int { kind == .compose ? 0 : text.count }
    }

    /// The Pinyin letters a person types for a word, from its romanization ("nǐ hǎo" gives "nihao").
    static func letters(_ romanized: String) -> String {
        String(romanized.lowercased().decomposedStringWithCanonicalMapping.unicodeScalars.filter { ("a"..."z").contains($0) }.map(Character.init))
    }

    static let backspace: Character = "\u{8}"

    static func isHan(_ c: Character) -> Bool {
        c.unicodeScalars.allSatisfy { (0x3400...0x9fff).contains($0.value) || (0x20000...0x3134f).contains($0.value) }
    }

    /// Chinese without a tokenizer: two characters at a time.
    static func pairs(_ text: String) -> [String] {
        var result: [String] = []
        var current = ""
        for c in text {
            current.append(c)
            if current.count == 2 { result.append(current); current = "" }
        }
        if !current.isEmpty { result.append(current) }
        return result
    }

    /// Letters go in one at a time at an uneven pace with a longer gap at each new word, as from a
    /// person's thumbs. Chinese goes in a word at a time, the way a Pinyin keyboard commits a chosen
    /// candidate, after about the time its Pinyin takes. A short text is paced slower than a long one,
    /// so a message never takes minutes. `words` splits a run of Chinese into words.
    ///
    /// With `pinyin` (a word's Pinyin, letters only), a Chinese word is typed the way a person types
    /// it: its Pinyin a key at a time into the composition, then the word in its place, as when the
    /// candidate is picked. A word with no Pinyin goes in whole.
    static func plan<G: RandomNumberGenerator>(_ text: String, words: (String) -> [String] = pairs, pinyin: ((String) -> String?)? = nil, using random: inout G) -> [Step] {
        let long = text.count > 40
        var steps: [Step] = []
        var han = ""
        var wordStart = true
        func flushHan(_ steps: inout [Step], _ random: inout G) {
            guard !han.isEmpty else { return }
            let split = words(han)
            // A tokenizer that loses a character must not lose it from the text.
            for word in (split.joined() == han ? split : pairs(han)) where !word.isEmpty {
                for piece in word.count > 4 ? pairs(word) : [word] {
                    if let keys = pinyin?(piece).map(letters), !keys.isEmpty, keys.count <= 8 * piece.count {
                        var shown = ""
                        for key in keys {
                            shown.append(key)
                            var pause = long ? Double.random(in: 0.008...0.018, using: &random) : Double.random(in: 0.022...0.048, using: &random)
                            // The thumb finds the first key of a word a little later.
                            if shown.count == 1 { pause += long ? Double.random(in: 0.004...0.012, using: &random) : Double.random(in: 0.025...0.070, using: &random) }
                            steps.append(Step(text: shown, pause: pause, kind: .compose))
                        }
                        // The glance at the candidates, and the tap on the first.
                        steps.append(Step(text: piece, pause: long ? Double.random(in: 0.015...0.035, using: &random) : Double.random(in: 0.050...0.110, using: &random), kind: .commit))
                        continue
                    }
                    let each = long ? Double.random(in: 0.030...0.060, using: &random) : Double.random(in: 0.055...0.100, using: &random)
                    steps.append(Step(text: piece, pause: 0.02 + each * Double(piece.count)))
                }
            }
            han = ""
        }
        for c in text {
            if isHan(c) { han.append(c); continue }
            flushHan(&steps, &random)
            var pause = long ? Double.random(in: 0.010...0.026, using: &random) : Double.random(in: 0.022...0.055, using: &random)
            if c == backspace {
                pause = Double.random(in: 0.015...0.030, using: &random)
            } else if wordStart, !c.isWhitespace {
                pause += long ? Double.random(in: 0.020...0.060, using: &random) : Double.random(in: 0.040...0.120, using: &random)
            }
            wordStart = c.isWhitespace || c.isPunctuation
            steps.append(Step(text: String(c), pause: pause))
        }
        flushHan(&steps, &random)
        return steps
    }

    static func seconds(of steps: [Step]) -> Double { steps.reduce(0) { $0 + $1.pause } }

    /// The text before the cursor once `text` is typed after `baseline`.
    static func expected(after baseline: String, typing text: String) -> String {
        var result = baseline
        for c in text {
            if c == backspace { if !result.isEmpty { result.removeLast() } } else { result.append(c) }
        }
        return result
    }

    /// Whether the text before the cursor ends the way the typed text should. The keyboard is given
    /// only the text near the cursor (often one sentence), so the ends are compared; with nothing to
    /// compare, the answer is unknown rather than a guess.
    static func check(expected: String, context: String?) -> KeyboardLink.Check {
        func trimmed(_ s: String) -> Substring {
            var t = Substring(s)
            while let last = t.last, last.isWhitespace { t.removeLast() }
            return t
        }
        let want = trimmed(expected), have = trimmed(context ?? "")
        let k = min(want.count, have.count)
        guard k > 0 else { return want.isEmpty && have.isEmpty && context != nil ? .matched : .unknown }
        return want.suffix(k) == have.suffix(k) ? .matched : .mismatch
    }
}

/// Types one request into the text field, on the main thread, a step at a time.
@MainActor
final class KeyboardTypist {
    struct Outcome: Equatable {
        var typed: Int
        var total: Int
        /// Every character was handled (not stopped part way).
        var finished: Bool
        var check: KeyboardLink.Check?
        var tail: String?
        var moved: Bool
    }

    /// Set to stop before the next step (the owner took over, the panel went away, Poki cancelled).
    private(set) var stopped = false
    func stop() { stopped = true }

    /// Most deletes one clear sends: a longer field is left with its start, and the check says so.
    static let clearLimit = 5000

    func run(_ request: KeyboardLink.Request, on document: KeyboardDocument, steps: [KeyboardTyper.Step],
             sleep: (Double) async -> Void = { try? await Task.sleep(nanoseconds: UInt64(max(0, $0) * 1_000_000_000)) },
             progress: (Int) -> Void = { _ in }, composing: (String) -> Void = { _ in }) async -> Outcome {
        let total = request.text.count
        let startDocument = document.documentID
        if request.clear { await clear(document, sleep: sleep) }
        let baseline = document.contextBefore ?? ""
        var typed = 0
        // Whether this field shows a composition and lets it go again, found at the first one. A
        // field that keeps the letters gets its Chinese whole, with no Pinyin before it.
        var composes: Bool?
        var open = false
        for step in steps {
            await sleep(step.pause)
            if stopped { break }
            switch step.kind {
            case .compose:
                if composes == nil {
                    let before = document.contextBefore
                    document.setMarked(step.text)
                    await sleep(0.03)
                    document.setMarked("")
                    await sleep(0.03)
                    let after = document.contextBefore
                    composes = after == before
                    if composes == false, let after, after == (before ?? "") + step.text {
                        for _ in step.text { document.deleteBackward() }
                    }
                }
                guard composes == true else { continue }
                document.setMarked(step.text)
                open = true
                composing(step.text)
            case .commit:
                if open { document.setMarked(""); open = false }
                composing("")
                document.insert(step.text)
            case .insert:
                if step.text == String(KeyboardTyper.backspace) { document.deleteBackward() } else { document.insert(step.text) }
            }
            typed += step.count
            if step.kind != .compose { progress(typed) }
        }
        // Stopped in the middle of a word: its Pinyin does not stay in the field.
        if open { document.setMarked(""); composing("") }
        // Stopped after the last character is still all of it.
        let finished = typed >= total
        // The field answers through another process: give the last insertion a moment to show.
        await sleep(0.08)
        let context = document.contextBefore
        let moved = document.documentID != startDocument
        var check: KeyboardLink.Check?
        if finished {
            // A Return usually sends or submits, and a field that moved has another text: neither is
            // judged against what was typed.
            check = request.text.last == "\n" || moved ? .unknown
                : KeyboardTyper.check(expected: KeyboardTyper.expected(after: baseline, typing: request.text), context: context)
        }
        let tail = request.hidden ? nil : context.map { String($0.suffix(200)) }
        return Outcome(typed: typed, total: total, finished: finished, check: check, tail: tail, moved: moved)
    }

    /// Empties the field: the cursor to its end, then Delete until nothing is before the cursor. The keyboard is
    /// shown the text a piece at a time, so it reads again after each piece.
    func clear(_ document: KeyboardDocument, sleep: (Double) async -> Void) async {
        // Only the field the request came for is emptied: when the focus moves on, nothing more is deleted.
        let field = document.documentID
        var emptyReads = 0
        for _ in 0..<200 where !stopped && document.documentID == field {
            let after = document.contextAfter ?? ""
            if after.isEmpty {
                // Nothing is shown past the end of a paragraph either: one step further finds the next.
                emptyReads += 1
                if emptyReads > 2 { break }
                document.moveCursor(by: 1)
            } else {
                emptyReads = 0
                document.moveCursor(by: after.utf16.count)
            }
            await sleep(0.03)
        }
        var sent = 0
        emptyReads = 0
        while sent < Self.clearLimit, !stopped, document.documentID == field {
            if let selected = document.selectedText, !selected.isEmpty {
                document.deleteBackward()
                sent += 1
                await sleep(0.03)
                continue
            }
            let before = document.contextBefore ?? ""
            if before.isEmpty {
                // Nothing is shown at the start of a paragraph either: one more Delete joins it to
                // the paragraph before, and at the very start does nothing.
                emptyReads += 1
                if emptyReads > 2 { break }
                document.deleteBackward()
                sent += 1
            } else {
                emptyReads = 0
                for _ in 0..<min(before.count, Self.clearLimit - sent) { document.deleteBackward() }
                sent += before.count
            }
            await sleep(0.03)
        }
    }
}
