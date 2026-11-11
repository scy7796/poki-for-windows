import Foundation

/// How Poki and its keyboard talk: small files in their App Group, and a Darwin notification that
/// says "look now".
///
/// No lock is ever held (iOS ends a process that is suspended holding a file lock in a shared
/// container), and neither side waits for the other on its main thread. A typing request is one
/// file that exactly one side takes, by renaming it: the keyboard to accept it, or Poki to withdraw
/// it. A rename is atomic, so a request the app gave up on can never be typed later, and a request
/// the keyboard took is never typed a second time by another method. The keyboard alone writes
/// `status.json`, replaced whole each time.
enum KeyboardLink {
    struct Request: Codable, Equatable {
        var id: String
        /// The keyboard refuses a request older than this (the app died before withdrawing it).
        var expires: Date
        var text: String
        /// Empty the field first.
        var clear = false
        /// A password or the like: nothing of the field's text goes into the status.
        var hidden = false
    }

    enum Phase: String, Codable { case idle, typing, done, stopped, takeover }

    /// What the field's text before the cursor says about the typed text.
    enum Check: String, Codable { case matched, mismatch, unknown }

    struct Status: Codable, Equatable {
        var updated = Date()
        /// The panel is on screen.
        var visible = false
        /// The request this status is about.
        var session: String?
        var phase = Phase.idle
        /// Characters handled so far, of `total`.
        var typed = 0
        var total = 0
        var check: Check?
        /// The end of the text before the cursor after typing (never for a hidden request).
        var tail: String?
        /// The text field changed under the typing (the app moved the focus, or the owner did).
        var moved = false
        var note: String?
    }

    /// Poki asks the keyboard to leave (the task is over); taken like a request.
    struct Release: Codable, Equatable {
        var expires: Date
    }

    /// A task of Poki's is under way: the panel stays up with nothing to type, so the agent does not
    /// have to bring it back for the next field. Poki renews it as the task goes on; the keyboard
    /// only reads it.
    struct Hold: Codable, Equatable {
        var expires: Date
    }

    static let holdFile = "hold.json"
    static let requestFile = "request.json"
    static let statusFile = "status.json"
    static let cancelFile = "cancel.json"
    static let releaseFile = "release.json"

    /// The App Group's folder for these files, from the bundle's `PokiAppGroup` (the signer rewrites
    /// it with the group). nil when the group is not available.
    static var directory: URL? {
        #if canImport(Darwin)
        guard let group = Bundle.main.object(forInfoDictionaryKey: "PokiAppGroup") as? String,
              let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
        else { return nil }
        return root.appendingPathComponent("KeyboardLink", isDirectory: true)
        #else
        return nil
        #endif
    }

    // MARK: Files

    static func read<T: Decodable>(_ type: T.Type, _ name: String, in directory: URL) -> T? {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// Writes the whole file at once (a temporary file renamed into place).
    @discardableResult
    static func write<T: Encodable>(_ value: T, _ name: String, in directory: URL) -> Bool {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(value)
            let temporary = directory.appendingPathComponent(".\(name).\(UUID().uuidString)")
            try data.write(to: temporary)
            #if canImport(Darwin)
            // Readable while the phone is locked after its first unlock: Poki works in the background.
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
            #endif
            guard rename(temporary.path, directory.appendingPathComponent(name).path) == 0 else {
                try? FileManager.default.removeItem(at: temporary)
                return false
            }
            return true
        } catch {
            return false
        }
    }

    static func remove(_ name: String, in directory: URL) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
    }

    /// Takes `name` for this caller alone: renames it to a name of its own, reads it and deletes it.
    /// nil when there is no such file, or the other side took it first.
    static func take<T: Decodable>(_ type: T.Type, _ name: String, in directory: URL) -> T? {
        let mine = directory.appendingPathComponent(".taken.\(UUID().uuidString)")
        guard rename(directory.appendingPathComponent(name).path, mine.path) == 0 else { return nil }
        defer { try? FileManager.default.removeItem(at: mine) }
        guard let data = try? Data(contentsOf: mine) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// Removes `name` so the other side can no longer take it. false when it was already taken.
    static func withdraw(_ name: String, in directory: URL) -> Bool {
        let mine = directory.appendingPathComponent(".withdrawn.\(UUID().uuidString)")
        guard rename(directory.appendingPathComponent(name).path, mine.path) == 0 else { return false }
        try? FileManager.default.removeItem(at: mine)
        return true
    }

    // MARK: Notifications

    /// Posted in this process when the other side says its files changed.
    static let changed = Notification.Name("PokiKeyboardLinkChanged")

    #if canImport(Darwin)
    private static var darwinName: CFString {
        "\(Bundle.main.object(forInfoDictionaryKey: "PokiAppGroup") as? String ?? "group.nz.zheha.poki").keyboard-link" as CFString
    }

    /// Tells the other process to look at the files now.
    static func signal() {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(darwinName), nil, nil, true)
    }

    /// Call once, on the main thread: `changed` is then posted on it whenever the other side signals.
    static func listen() {
        CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil, { _, _, _, _, _ in
            NotificationCenter.default.post(name: KeyboardLink.changed, object: nil)
        }, darwinName, nil, .deliverImmediately)
    }
    #else
    static func signal() {}
    static func listen() {}
    #endif
}
