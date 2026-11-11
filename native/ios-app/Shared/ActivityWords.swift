import Foundation

/// The Live Activity's words, in English and Simplified Chinese (LiveActivity.xcstrings, carried by
/// both the app and the widget extension), following the system language. The table is the Live
/// Activity's own; the app's other screens have theirs in Localizable.xcstrings. Home and All Steps
/// borrow `label` for PokiCore's step labels.
///
/// How much it says (ESP-162): a status word, one or two words (two to four Chinese characters), and
/// one content line, at most four words (eight Chinese characters). How to do something is never
/// here; tapping the activity opens Poki, which explains it.
///
/// The app keeps the state's words in English ("Runner Stopped", "Waiting for agent", PokiCore's
/// "Tap “Send”"), and the face words them in the system's language when it draws them, so the
/// app's own checks on them do not depend on the language.
enum ActivityWords {
    static let table = "LiveActivity"

    /// A word the app keeps in English, in the system's language. A text the table does not have (an
    /// error from the pairing) stays as it is.
    static func local(_ key: String) -> String {
        Bundle.main.localizedString(forKey: key, value: key, table: table)
    }

    /// The content line: at most four words, or eight Chinese characters, ending in "…" when cut.
    /// A word is a run of letters and digits ("1:24" and "don’t" are one); each Chinese character
    /// counts on its own, punctuation not at all.
    static func brief(_ text: String) -> String {
        let limit = text.unicodeScalars.contains(where: isHan) ? 8 : 4
        var units = 0
        var inWord = false
        for index in text.indices {
            let c = text[index]
            let han = c.unicodeScalars.contains(where: isHan)
            let wordy = !han && (c.isLetter || c.isNumber || inWord && "’'-:./".contains(c))
            if han || wordy && !inWord {
                units += 1
                if units > limit { return cut(text[..<index]) }
            }
            inWord = wordy
        }
        return text
    }

    /// A step label from PokiCore as the content line: the first of several actions ("Tap “Search”,
    /// then type “cats”" is "Tap “Search”"), in the system's language, at most four words.
    static func step(_ label: String) -> String {
        brief(translate(label.components(separatedBy: ", then ").first ?? label))
    }

    /// A step label from PokiCore in the system's language, whole, for the app's own screens.
    static func label(_ label: String) -> String { translate(label) }

    private static func isHan(_ scalar: Unicode.Scalar) -> Bool {
        (0x3400...0x9FFF).contains(scalar.value) || (0xF900...0xFAFF).contains(scalar.value)
    }

    private static func cut(_ text: Substring) -> String {
        var line = text.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ",，、:：")))
        line += "…"
        // A name cut inside its quotes keeps the closing one.
        if line.filter({ $0 == "“" }).count > line.filter({ $0 == "”" }).count { line += "”" }
        return line
    }

    /// The labels PokiCore writes (Computer.label in PokiCore's StepLabels.swift). Those with a name
    /// or a value in them are matched here; the fixed ones ("Swipe up", "Drag") and the app's own
    /// lines ("Starting the runner") are looked up as they are.
    private static func translate(_ label: String) -> String {
        func quoted(_ verb: String) -> String? {
            guard label.hasPrefix(verb + " “"), label.hasSuffix("”") else { return nil }
            return String(label.dropFirst(verb.count + 2).dropLast())
        }
        func after(_ words: String) -> String? {
            label.hasPrefix(words + " ") ? String(label.dropFirst(words.count + 1)) : nil
        }
        if let name = quoted("Tap") { return String(activity: "Tap “\(name)”") }
        if let name = quoted("Press and hold") { return String(activity: "Press and hold “\(name)”") }
        if let text = quoted("Type") { return String(activity: "Type “\(text)”") }
        if let name = quoted("Scroll to") { return String(activity: "Scroll to “\(name)”") }
        if let point = after("Tap at") { return String(activity: "Tap at \(point)") }
        if let point = after("Press and hold at") { return String(activity: "Press and hold at \(point)") }
        if let rest = after("Type"), rest.hasSuffix(" hidden characters"), let count = Int(rest.prefix { $0.isNumber }) {
            return String(activity: "Type \(count) hidden characters")
        }
        let fixed = local(label)
        if fixed != label { return fixed }
        if let rest = after("Press"), rest.hasSuffix(" button") { return String(activity: "Press \(String(rest.dropLast(7))) button") }
        if let key = after("Press") { return String(activity: "Press \(key)") }
        if let app = after("Open") { return String(activity: "Open \(app)") }
        return label
    }
}

extension String {
    /// One of the Live Activity's words, from its own table.
    init(activity key: String.LocalizationValue) {
        self.init(localized: key, table: ActivityWords.table)
    }
}
