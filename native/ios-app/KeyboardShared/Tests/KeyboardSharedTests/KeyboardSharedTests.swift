import XCTest
@testable import KeyboardShared

/// A text field with a cursor, showing the keyboard only the current line (as apps often do).
@MainActor
final class FakeDocument: KeyboardDocument {
    var text: [Character] = []
    var cursor = 0
    var documentID = UUID()
    /// Called after each insertion: an app reformatting, or moving the focus.
    var afterInsert: ((FakeDocument) -> Void)?
    init(_ text: String = "", cursor: Int? = nil) {
        self.text = Array(text)
        self.cursor = cursor ?? text.count
    }
    var string: String { String(text) }
    var contextBefore: String? {
        let before = text[..<cursor]
        guard let line = before.lastIndex(of: "\n") else { return String(before) }
        return String(before[(line + 1)...])
    }
    var contextAfter: String? { String(text[cursor...].prefix { $0 != "\n" }) }
    var selectedText: String? { nil }
    /// Characters before the cursor that are the composition.
    var marked = 0
    /// A field that does not take a composition back: its letters stay as text.
    var keepsMarked = false
    /// Every composition shown, in order.
    var compositions: [String] = []
    func setMarked(_ s: String) {
        if !keepsMarked {
            text.removeSubrange((cursor - marked)..<cursor)
            cursor -= marked
        }
        text.insert(contentsOf: Array(s), at: cursor)
        cursor += s.count
        marked = keepsMarked ? 0 : s.count
        if !s.isEmpty { compositions.append(s) }
    }
    func insert(_ s: String) {
        text.removeSubrange((cursor - marked)..<cursor)
        cursor -= marked
        marked = 0
        text.insert(contentsOf: Array(s), at: cursor)
        cursor += s.count
        afterInsert?(self)
    }
    func deleteBackward() {
        guard cursor > 0 else { return }
        text.remove(at: cursor - 1)
        cursor -= 1
    }
    func moveCursor(by offset: Int) { cursor = max(0, min(text.count, cursor + offset)) }
}

struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

@MainActor
final class KeyboardSharedTests: XCTestCase {
    func request(_ text: String, clear: Bool = false, hidden: Bool = false) -> KeyboardLink.Request {
        KeyboardLink.Request(id: "r", expires: Date().addingTimeInterval(5), text: text, clear: clear, hidden: hidden)
    }
    func steps(_ text: String) -> [KeyboardTyper.Step] {
        var g = SeededGenerator(state: 7)
        return KeyboardTyper.plan(text, using: &g)
    }
    func type(_ text: String, into document: FakeDocument, clear: Bool = false, hidden: Bool = false, typist: KeyboardTypist? = nil) async -> KeyboardTypist.Outcome {
        await (typist ?? KeyboardTypist()).run(request(text, clear: clear, hidden: hidden), on: document, steps: steps(text), sleep: { _ in })
    }

    func testPlanKeepsEveryCharacterInOrder() {
        for text in ["Hello, world!", "今天我们一起测试中文输入", "Wi-Fi 你好 123 👨‍👩‍👧 café\n", "ab\u{8}\u{8}cd", "一"] {
            XCTAssertEqual(steps(text).map(\.text).joined(), text)
        }
    }

    func testPlanTypesLettersSinglyAndChineseByWord() {
        let plan = steps("Hi 你好世界")
        XCTAssertEqual(plan.map(\.text), ["H", "i", " ", "你好", "世界"])
        var g = SeededGenerator(state: 1)
        let tokenized = KeyboardTyper.plan("我们一起", words: { _ in ["我们", "一起"] }, using: &g)
        XCTAssertEqual(tokenized.map(\.text), ["我们", "一起"])
        // A tokenizer that drops text is not trusted.
        let lossy = KeyboardTyper.plan("我们一起", words: { _ in ["我们"] }, using: &g)
        XCTAssertEqual(lossy.map(\.text).joined(), "我们一起")
    }

    static let pinyin = ["你好": "nǐ hǎo", "世界": "shì jiè", "装": "zhuāng"]
    func composed(_ text: String) -> [KeyboardTyper.Step] {
        var g = SeededGenerator(state: 7)
        return KeyboardTyper.plan(text, pinyin: { Self.pinyin[$0] }, using: &g)
    }

    func testPlanTypesPinyinThenTheWord() {
        let plan = composed("Hi 你好")
        XCTAssertEqual(plan.map(\.text), ["H", "i", " ", "n", "ni", "nih", "niha", "nihao", "你好"])
        XCTAssertEqual(plan.map(\.kind), [.insert, .insert, .insert, .compose, .compose, .compose, .compose, .compose, .commit])
        XCTAssertEqual(plan.map(\.count).reduce(0, +), 5)
        // A word with no Pinyin goes in whole.
        XCTAssertEqual(composed("一").map(\.kind), [.insert])
        // As fast as the app allows for (0.12 s a character), even at six letters a character.
        var g = SeededGenerator(state: 3)
        let long = KeyboardTyper.plan(String(repeating: "装", count: 600), words: { $0.map(String.init) }, pinyin: { _ in "zhuāng" }, using: &g)
        XCTAssertLessThan(KeyboardTyper.seconds(of: long), 600 * 0.12)
    }

    func testComposesInTheFieldAndLeavesOnlyTheWord() async {
        let document = FakeDocument("Dear ")
        let outcome = await KeyboardTypist().run(request("你好世界!"), on: document, steps: composed("你好世界!"), sleep: { _ in })
        XCTAssertEqual(document.string, "Dear 你好世界!")
        XCTAssertTrue(document.compositions.contains("nihao"))
        XCTAssertTrue(document.compositions.contains("shijie"))
        XCTAssertEqual(outcome.typed, 5)
        XCTAssertTrue(outcome.finished)
        XCTAssertEqual(outcome.check, .matched)
    }

    func testAFieldThatKeepsTheLettersGetsTheWordWhole() async {
        let document = FakeDocument()
        document.keepsMarked = true
        let outcome = await KeyboardTypist().run(request("你好世界"), on: document, steps: composed("你好世界"), sleep: { _ in })
        XCTAssertEqual(document.string, "你好世界")
        XCTAssertEqual(outcome.check, .matched)
    }

    func testStopInAWordLeavesNoPinyin() async {
        let document = FakeDocument()
        let typist = KeyboardTypist()
        var shown = 0
        _ = await typist.run(request("你好"), on: document, steps: composed("你好"), sleep: { _ in }, composing: { _ in
            shown += 1
            if shown == 3 { typist.stop() }
        })
        XCTAssertEqual(document.string, "")
    }

    func testPlanPaceIsBounded() {
        let short = steps("Hello there")
        XCTAssertLessThan(KeyboardTyper.seconds(of: short), 1.5)
        XCTAssertGreaterThan(KeyboardTyper.seconds(of: short), 0.2)
        let long = steps(String(repeating: "The quick brown fox. ", count: 95))
        XCTAssertLessThan(KeyboardTyper.seconds(of: long), 2000 * 0.09)
        let chinese = steps(String(repeating: "今天天气很好", count: 300))
        XCTAssertLessThan(KeyboardTyper.seconds(of: chinese), 1800 * 0.09)
    }

    func testTypesAtTheCursorAndChecks() async {
        let document = FakeDocument("Dear ")
        let outcome = await type("Sam, 你好!", into: document)
        XCTAssertEqual(document.string, "Dear Sam, 你好!")
        XCTAssertEqual(outcome, .init(typed: 8, total: 8, finished: true, check: .matched, tail: "Dear Sam, 你好!", moved: false))
    }

    func testBackspacesDeleteAndCount() async {
        let document = FakeDocument("abc")
        let outcome = await type("\u{8}\u{8}xy", into: document)
        XCTAssertEqual(document.string, "axy")
        XCTAssertEqual(outcome.check, .matched)
        XCTAssertEqual(outcome.typed, 4)
    }

    func testClearEmptiesAcrossLinesFromTheMiddle() async {
        let document = FakeDocument("first line\nsecond line\nthird", cursor: 14)
        let outcome = await type("new", into: document, clear: true)
        XCTAssertEqual(document.string, "new")
        XCTAssertEqual(outcome.check, .matched)
    }

    func testClearStopsWhenTheFocusMovesToAnotherField() async {
        let document = FakeDocument("first line\nsecond line", cursor: 3)
        var sleeps = 0
        // The focus moves on during the clear: the other field's text is not deleted.
        await KeyboardTypist().clear(document, sleep: { _ in
            sleeps += 1
            if sleeps == 1 { document.documentID = UUID() }
        })
        XCTAssertEqual(document.string, "first line\nsecond line")
    }

    func testHiddenTextIsNotEchoed() async {
        let document = FakeDocument()
        let outcome = await type("hunter2", into: document, hidden: true)
        XCTAssertNil(outcome.tail)
        XCTAssertEqual(outcome.check, .matched)
    }

    func testAppThatReformatsIsAMismatchNotAStop() async {
        let document = FakeDocument()
        document.afterInsert = { d in
            // A card field: a space after every fourth digit.
            let digits = d.text.filter { $0 != " " }
            var out: [Character] = []
            for (i, c) in digits.enumerated() { if i > 0, i % 4 == 0 { out.append(" ") }; out.append(c) }
            d.text = out
            d.cursor = out.count
        }
        let outcome = await type("42424242", into: document)
        XCTAssertEqual(document.string, "4242 4242")
        XCTAssertTrue(outcome.finished)
        XCTAssertEqual(outcome.check, .mismatch)
    }

    func testFieldThatMovesIsTypedThroughAndReported() async {
        // One-time-code boxes: the app moves to the next box after each digit.
        let document = FakeDocument()
        var boxes: [String] = []
        document.afterInsert = { d in boxes.append(d.string); d.text = []; d.cursor = 0; d.documentID = UUID() }
        let outcome = await type("123456", into: document)
        XCTAssertEqual(boxes, ["1", "2", "3", "4", "5", "6"])
        XCTAssertTrue(outcome.finished)
        XCTAssertTrue(outcome.moved)
        XCTAssertEqual(outcome.check, .unknown)
    }

    func testReturnAtTheEndIsNotJudged() async {
        let document = FakeDocument()
        document.afterInsert = { d in if d.text.last == "\n" { d.text = []; d.cursor = 0 } }
        let outcome = await type("search this\n", into: document)
        XCTAssertTrue(outcome.finished)
        XCTAssertEqual(outcome.check, .unknown)
    }

    func testStopLeavesTheRestUntyped() async {
        let document = FakeDocument()
        let typist = KeyboardTypist()
        document.afterInsert = { d in if d.text.count == 3 { typist.stop() } }
        let outcome = await type("abcdefgh", into: document, typist: typist)
        XCTAssertEqual(document.string, "abc")
        XCTAssertEqual(outcome.typed, 3)
        XCTAssertFalse(outcome.finished)
        XCTAssertNil(outcome.check)
    }

    func testCheckComparesEndsOnly() {
        XCTAssertEqual(KeyboardTyper.check(expected: "First. Second one", context: "Second one"), .matched)
        XCTAssertEqual(KeyboardTyper.check(expected: "hello ", context: "hello"), .matched)
        XCTAssertEqual(KeyboardTyper.check(expected: "hello", context: "hellp"), .mismatch)
        XCTAssertEqual(KeyboardTyper.check(expected: "hello", context: nil), .unknown)
        XCTAssertEqual(KeyboardTyper.check(expected: "hello", context: ""), .unknown)
        XCTAssertEqual(KeyboardTyper.check(expected: "", context: ""), .matched)
    }

    func testARequestIsTakenByExactlyOneSide() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("poki-link-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let r = request("hi")
        XCTAssertTrue(KeyboardLink.write(r, KeyboardLink.requestFile, in: directory))
        XCTAssertEqual(KeyboardLink.read(KeyboardLink.Request.self, KeyboardLink.requestFile, in: directory)?.id, "r")
        // The keyboard takes it: the app can no longer withdraw it, and nobody can take it again.
        XCTAssertEqual(KeyboardLink.take(KeyboardLink.Request.self, KeyboardLink.requestFile, in: directory), r)
        XCTAssertFalse(KeyboardLink.withdraw(KeyboardLink.requestFile, in: directory))
        XCTAssertNil(KeyboardLink.take(KeyboardLink.Request.self, KeyboardLink.requestFile, in: directory))
        // The app withdraws one: the keyboard finds nothing.
        XCTAssertTrue(KeyboardLink.write(r, KeyboardLink.requestFile, in: directory))
        XCTAssertTrue(KeyboardLink.withdraw(KeyboardLink.requestFile, in: directory))
        XCTAssertNil(KeyboardLink.take(KeyboardLink.Request.self, KeyboardLink.requestFile, in: directory))
        // Nothing of the request is left on disk.
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
    }

    func testStatusRoundTrips() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("poki-link-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        var status = KeyboardLink.Status()
        status.session = "r"; status.phase = .done; status.check = .matched; status.typed = 2; status.total = 2
        XCTAssertTrue(KeyboardLink.write(status, KeyboardLink.statusFile, in: directory))
        XCTAssertEqual(KeyboardLink.read(KeyboardLink.Status.self, KeyboardLink.statusFile, in: directory)?.phase, .done)
    }
}
