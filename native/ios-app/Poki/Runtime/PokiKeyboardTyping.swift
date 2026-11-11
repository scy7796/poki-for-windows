import Foundation

/// Typing through Poki's keyboard (PokiKeyboard, over KeyboardLink): the text reaches the app the
/// way any keyboard's does, and the keyboard itself says what the field holds afterwards, so nothing
/// on the screen is read while typing.
///
/// `declined` means the keyboard never had the text (it is not added, is not the keyboard in use and
/// could not be brought up, or the field takes no third-party keyboard): only then is the text typed
/// another way. Once the keyboard has taken the text it is never typed again by anything else.
final class PokiKeyboardTyping {
    enum Answer {
        case typed(KeyboardLink.Status)
        case declined(String)
    }

    struct Options {
        var clear = false
        var hidden = false
        /// A text field is believed to have the focus, so another keyboard may be switched away from.
        var maySwitch = false
        /// The app in front, when known (a failed switch is remembered for it).
        var app: String?
        /// Seconds the caller gives the whole type.
        var budget = 30.0
    }

    /// Chooses Poki from the globe key's list of the keyboard on screen: why it could not, or nil,
    /// and whether it went the quick way (from the list's remembered places, without reading it).
    /// `true` asks for the list to be read afresh.
    let chooseFromGlobe: (Bool) async throws -> (why: String?, quick: Bool)
    init(chooseFromGlobe: @escaping (Bool) async throws -> (why: String?, quick: Bool)) { self.chooseFromGlobe = chooseFromGlobe }

    // MARK: What is set up

    static var keyboardID: String { (Bundle.main.bundleIdentifier ?? "nz.zheha.poki") + ".keyboard" }

    /// The keyboard's name in the globe key's list (its CFBundleDisplayName).
    static let displayName = "Poki"

    /// The keyboards turned on in Settings, as iOS lists them (empty when it does not say).
    static var keyboards: [String] { UserDefaults.standard.stringArray(forKey: "AppleKeyboards") ?? [] }

    static var added: Bool {
        let app = Bundle.main.bundleIdentifier ?? "nz.zheha.poki"
        return keyboards.contains { $0 == keyboardID || $0.hasPrefix(app + ".") }
    }

    /// The keyboard's last word. It can only write this with Full Access, so its presence shows that
    /// the keyboard has run with it.
    static var lastStatus: KeyboardLink.Status? {
        KeyboardLink.directory.flatMap { KeyboardLink.read(KeyboardLink.Status.self, KeyboardLink.statusFile, in: $0) }
    }

    /// Worth asking the keyboard at all: iOS lists it as added, does not say which keyboards are
    /// added, or the keyboard has answered here before. (Only a list without it rules it out.)
    static var available: Bool { added || keyboards.isEmpty || lastStatus != nil }

    static func setting(_ key: String) -> Bool { UserDefaults.standard.object(forKey: key) as? Bool ?? true }
    static let autoSwitchKey = "poki.keyboard.autoSwitch"
    static let switchBackKey = "poki.keyboard.switchBack"

    private static let lock = NSLock()
    private static var failedSwitches: [String: Date] = [:]
    private static func switchFailedLately(_ app: String?) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return failedSwitches[app ?? ""].map { Date().timeIntervalSince($0) < 600 } ?? false
    }
    private static func noteSwitch(_ app: String?, failed: Bool) {
        lock.lock(); defer { lock.unlock() }
        failedSwitches[app ?? ""] = failed ? Date() : nil
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "PokiKeyboard", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    /// The owner tapped Take Over on the panel.
    static func takeover(_ message: String) -> NSError {
        NSError(domain: "PokiKeyboard", code: 2, userInfo: [NSLocalizedDescriptionKey: message])
    }

    /// What a text needs at the keyboard's pace, with room to spare.
    static func seconds(for text: String) -> Double { 3 + 0.12 * Double(text.count) }

    // MARK: Typing

    func type(_ text: String, _ options: Options) async throws -> Answer {
        guard Self.available else { return .declined("the Poki keyboard is not added in Settings") }
        guard let directory = KeyboardLink.directory else { return .declined("the App Group is not available") }
        guard !text.isEmpty, text.count <= 2000 else { return .declined("the text is empty or over 2000 characters") }
        let started = Date()
        func left() -> Double { options.budget - Date().timeIntervalSince(started) - Self.seconds(for: text) }
        let id = UUID().uuidString
        // A leave asked for at the end of the last task must not send the keyboard away now.
        KeyboardLink.remove(KeyboardLink.releaseFile, in: directory)
        KeyboardLink.remove(KeyboardLink.cancelFile, in: directory)
        let request = KeyboardLink.Request(id: id, expires: Date().addingTimeInterval(max(4, min(30, left() + 2))), text: text, clear: options.clear, hidden: options.hidden)
        guard KeyboardLink.write(request, KeyboardLink.requestFile, in: directory) else { return .declined("the request could not be written") }
        KeyboardLink.signal()
        do {
            // The keyboard takes the request as it comes up with the field's focus; a keyboard already
            // up answers in a few milliseconds.
            let switching = options.maySwitch && Self.setting(Self.autoSwitchKey) && !Self.switchFailedLately(options.app)
            // A panel that last said it was not on screen is not waited for: straight to the switch.
            let up = Self.lastStatus?.visible == true
            var accepted = try await acknowledged(id, in: directory, within: up || !switching ? min(0.8, max(0.3, left())) : 0.12)
            var whyNot: String?
            if !accepted, switching {
                whyNot = try await bringUp(id, in: directory, left: left)
                accepted = whyNot == nil
                Self.noteSwitch(options.app, failed: !accepted)
            }
            if !accepted {
                if KeyboardLink.withdraw(KeyboardLink.requestFile, in: directory) {
                    return .declined(switching ? (whyNot ?? "it did not come up when Poki switched keyboards")
                        : !options.maySwitch ? "it was not the keyboard in use, and no text field was known to have the focus"
                        : !Self.setting(Self.autoSwitchKey) ? "it was not the keyboard in use, and switching to it is turned off"
                        : "it was not the keyboard in use, and switching to it failed in this app a few minutes ago")
                }
                // It took the request in this very moment.
                guard try await acknowledged(id, in: directory, within: 1.5) else {
                    throw Self.failure("The Poki keyboard took the text but did not answer. Look at the field before typing again; nothing was typed another way.")
                }
            }
            return try await follow(id, text: text, in: directory)
        } catch is CancellationError {
            // The caller's time ran out or the task was stopped: the keyboard must not start, or go on.
            if !KeyboardLink.withdraw(KeyboardLink.requestFile, in: directory) {
                KeyboardLink.write(["id": id], KeyboardLink.cancelFile, in: directory)
                KeyboardLink.signal()
            }
            throw CancellationError()
        }
    }

    /// The keyboard leaves for the owner's own keyboard: now when it is up, else as it next comes up.
    static func release() {
        guard available, setting(switchBackKey), let directory = KeyboardLink.directory else { return }
        KeyboardLink.write(KeyboardLink.Release(expires: Date().addingTimeInterval(600)), KeyboardLink.releaseFile, in: directory)
        KeyboardLink.signal()
    }

    private func status(_ id: String, in directory: URL) -> KeyboardLink.Status? {
        guard let status = KeyboardLink.read(KeyboardLink.Status.self, KeyboardLink.statusFile, in: directory), status.session == id else { return nil }
        return status
    }

    private func acknowledged(_ id: String, in directory: URL, within seconds: Double) async throws -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while true {
            if status(id, in: directory) != nil { return true }
            guard Date() < deadline else { return false }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
    }

    /// Watches the keyboard type, to its last word about it.
    private func follow(_ id: String, text: String, in directory: URL) async throws -> Answer {
        let deadline = Date().addingTimeInterval(Self.seconds(for: text) + 12 + (text.isEmpty ? 0 : 1))
        while true {
            if let status = status(id, in: directory) {
                switch status.phase {
                case .done:
                    return .typed(status)
                case .takeover:
                    throw Self.takeover("The owner took over after \(status.typed) of \(status.total) characters.")
                case .stopped:
                    // Nothing went in: the text may still be typed another way.
                    if status.typed == 0 { return .declined(status.note ?? "the Poki keyboard stopped before typing") }
                    throw Self.failure("The Poki keyboard typed \(status.typed) of \(status.total) characters, then stopped: \(status.note ?? "no reason given"). Look at the field before typing the rest; nothing was typed again.")
                case .typing, .idle:
                    if Date().timeIntervalSince(status.updated) > 6 {
                        throw Self.failure("The Poki keyboard stopped answering after \(status.typed) of \(status.total) characters. Look at the field before typing the rest; nothing was typed again.")
                    }
                }
            }
            guard Date() < deadline else {
                KeyboardLink.write(["id": id], KeyboardLink.cancelFile, in: directory)
                KeyboardLink.signal()
                throw Self.failure("The Poki keyboard did not finish in time. Look at the field before typing the rest; nothing was typed again.")
            }
            try await Task.sleep(nanoseconds: 30_000_000)
        }
    }

    // MARK: Switching to the keyboard

    /// Why the keyboard was last not used, for Settings and the answer.
    static let lastDeclineKey = "poki.keyboard.lastDecline"

    /// Brings Poki's keyboard up from another keyboard the way a person does: the globe key is held
    /// and Poki is chosen from the list of keyboards (`chooseFromGlobe`, two reads of the screen and
    /// two touches). Returns nil once the keyboard itself has answered, else why it did not.
    private func bringUp(_ id: String, in directory: URL, left: () -> Double) async throws -> String? {
        guard left() > 3 else { return "there was no time left to switch keyboards" }
        let first = try await chooseFromGlobe(false)
        if let why = first.why { return why }
        // The extension may start cold.
        if try await acknowledged(id, in: directory, within: first.quick ? 1.6 : min(3, max(1, left()))) { return nil }
        if first.quick, left() > 3 {
            // The list was not where it was last time: once more, reading it.
            if let why = try await chooseFromGlobe(true).why { return why }
            if try await acknowledged(id, in: directory, within: min(3, max(1, left()))) { return nil }
        }
        return "it was chosen from the globe key's list but did not answer (the field may take no other keyboard, or Full Access is off)"
    }
}
