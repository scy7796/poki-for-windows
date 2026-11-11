import NaturalLanguage
import SwiftUI
import UIKit

/// The text field, through the keyboard's document proxy (read afresh each time: it follows the focus).
@MainActor
private final class ProxyDocument: KeyboardDocument {
    unowned let controller: UIInputViewController
    init(_ controller: UIInputViewController) { self.controller = controller }
    var contextBefore: String? { controller.textDocumentProxy.documentContextBeforeInput }
    var contextAfter: String? { controller.textDocumentProxy.documentContextAfterInput }
    var selectedText: String? { controller.textDocumentProxy.selectedText }
    var documentID: UUID { controller.textDocumentProxy.documentIdentifier }
    func insert(_ text: String) { controller.textDocumentProxy.insertText(text) }
    func deleteBackward() { controller.textDocumentProxy.deleteBackward() }
    func moveCursor(by offset: Int) { controller.textDocumentProxy.adjustTextPosition(byCharacterOffset: offset) }
    func setMarked(_ text: String) {
        let proxy = controller.textDocumentProxy
        proxy.setMarkedText(text, selectedRange: NSRange(location: text.utf16.count, length: 0))
        if text.isEmpty { proxy.unmarkText() }
    }
}

/// Poki's keyboard: a panel with no keys that types what Poki sends it (KeyboardLink), the way any
/// keyboard puts text into a field. It never reads the pasteboard and has no network code.
///
/// It stays out of the owner's way: it leaves for the next keyboard a few seconds after it comes up
/// with nothing to type, a while after it last typed, and at once when Poki says the task is over or
/// the owner takes over. While a task of Poki's is under way (KeyboardLink.Hold) it does not leave by
/// itself, so the agent never has to bring it back between two fields.
final class KeyboardViewController: UIInputViewController {
    private let model = PanelModel()
    private let globe = UIButton(type: .system)
    private var height: NSLayoutConstraint?

    private var visible = false
    /// Left for the next keyboard during this appearance (asked once only).
    private var left = false
    private var typist: KeyboardTypist?
    private var status = KeyboardLink.Status()
    private var tookOver = false
    private var cancelled = false
    private var lastStatusWrite = Date.distantPast
    private var timer: Timer?
    private var leaveWork: DispatchWorkItem?
    private static var listening = false

    /// With nothing to type: long enough for Poki's request to arrive after the field was tapped.
    private static let idleSeconds = 4.0
    /// After typing: the next field of the same task usually follows within this.
    private static let lingerSeconds = 45.0

    override func viewDidLoad() {
        super.viewDidLoad()
        // Clear, so the system's own keyboard backdrop shows.
        view.backgroundColor = .clear
        let host = UIHostingController(rootView: KeyboardPanel(model: model))
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        view.addSubview(host.view)
        host.didMove(toParent: self)

        // The system's keyboard switcher, where iOS asks the keyboard to show one (iPad, and iPhones
        // with a Home button; other iPhones have it under the keyboard).
        globe.setImage(UIImage(systemName: "globe"), for: .normal)
        globe.tintColor = .label
        globe.accessibilityLabel = Words.nextKeyboard
        globe.translatesAutoresizingMaskIntoConstraints = false
        globe.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
        view.addSubview(globe)

        let height = view.heightAnchor.constraint(equalToConstant: preferredHeight)
        height.priority = UILayoutPriority(999)
        self.height = height
        NSLayoutConstraint.activate([
            height,
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            globe.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8),
            globe.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -4),
            globe.widthAnchor.constraint(equalToConstant: 44),
            globe.heightAnchor.constraint(equalToConstant: 44),
        ])

        model.takeOver = { [weak self] in self?.takeOver() }
        model.switchKeyboard = { [weak self] in self?.leave(asked: true) }

        if !Self.listening {
            Self.listening = true
            KeyboardLink.listen()
        }
        NotificationCenter.default.addObserver(self, selector: #selector(linkChanged), name: KeyboardLink.changed, object: nil)
    }

    @objc private func linkChanged() { check() }

    /// About a system keyboard's height, so the app's layout does not jump when Poki's comes up.
    private var preferredHeight: CGFloat {
        if traitCollection.userInterfaceIdiom == .pad { return 320 }
        return traitCollection.verticalSizeClass == .compact ? 180 : 260
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        globe.isHidden = !needsInputModeSwitchKey
        if let height, height.constant != preferredHeight { height.constant = preferredHeight }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        visible = true
        left = false
        refreshMode()
        // What the last appearance (or the last keyboard process) left: a session just over means
        // the task is likely still going.
        let previous = directory.flatMap { KeyboardLink.read(KeyboardLink.Status.self, KeyboardLink.statusFile, in: $0) }
        let recent = previous.map { $0.session != nil && Date().timeIntervalSince($0.updated) < Self.lingerSeconds } ?? false
        if typist == nil {
            status = previous ?? KeyboardLink.Status()
            status.visible = true
            status.tail = nil
            writeStatus()
        }
        timer?.invalidate()
        // The notification is the fast path; this catches one that was missed.
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.check() }
        }
        check()
        if typist == nil { scheduleLeave(after: recent ? Self.lingerSeconds : Self.idleSeconds) }
    }

    override func viewWillDisappear(_ animated: Bool) {
        visible = false
        timer?.invalidate()
        timer = nil
        leaveWork?.cancel()
        // The field went away or the owner changed keyboards: nothing more is typed. The run ends at
        // its next step and writes what happened.
        if let typist {
            typist.stop()
        } else {
            status.visible = false
            status.tail = nil
            writeStatus()
        }
        super.viewWillDisappear(animated)
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        check()
    }

    // MARK: Poki's requests

    private var directory: URL? { hasFullAccess ? KeyboardLink.directory : nil }

    private func refreshMode() {
        model.mode = typist != nil ? .typing : hasFullAccess ? .idle : .needsFullAccess
        model.held = heldUntil != nil
    }

    /// When the hold of Poki's task under way runs out; nil with no task.
    private var heldUntil: Date? {
        guard let directory, let hold = KeyboardLink.read(KeyboardLink.Hold.self, KeyboardLink.holdFile, in: directory), hold.expires > Date() else { return nil }
        return hold.expires
    }

    @discardableResult
    private func writeStatus() -> Bool {
        guard let directory else { return false }
        status.updated = Date()
        lastStatusWrite = status.updated
        return KeyboardLink.write(status, KeyboardLink.statusFile, in: directory)
    }

    private func check() {
        guard visible, let directory else { return }
        if typist != nil {
            // Poki gave up on this request (its time ran out, or the task was stopped).
            if !cancelled, let cancel = KeyboardLink.read([String: String].self, KeyboardLink.cancelFile, in: directory), cancel["id"] == status.session {
                cancelled = true
                typist?.stop()
            }
            return
        }
        let held = heldUntil != nil
        if model.held != held { model.held = held }
        if let request = KeyboardLink.take(KeyboardLink.Request.self, KeyboardLink.requestFile, in: directory) {
            begin(request)
        } else if let release = KeyboardLink.take(KeyboardLink.Release.self, KeyboardLink.releaseFile, in: directory), release.expires > Date() {
            // The task is over: back to the owner's keyboard, at once.
            leave(asked: true)
        }
    }

    private func begin(_ request: KeyboardLink.Request) {
        leaveWork?.cancel()
        tookOver = false
        cancelled = false
        status = KeyboardLink.Status(visible: true, session: request.id, phase: .typing, total: request.text.count)
        guard request.expires > Date() else {
            status.phase = .stopped
            status.note = "the request had expired"
            writeStatus()
            scheduleLeave(after: Self.idleSeconds)
            return
        }
        // Poki hears that the keyboard has the text before a character goes in. If it cannot be
        // told, nothing is typed: it would not know, and might type the text another way as well.
        guard writeStatus() else { return }
        let typist = KeyboardTypist()
        self.typist = typist
        model.text = request.hidden ? nil : request.text
        model.total = request.text.count
        model.typed = 0
        model.composing = ""
        refreshMode()
        var random = SystemRandomNumberGenerator()
        // A password is never composed: nothing of it is shown, in the field or on the panel.
        let steps = KeyboardTyper.plan(request.text, words: Self.words, pinyin: request.hidden ? nil : Self.pinyin, using: &random)
        Task { @MainActor [self] in
            let outcome = await typist.run(request, on: ProxyDocument(self), steps: steps, progress: { [weak self] typed in
                guard let self else { return }
                self.model.typed = typed
                self.status.typed = typed
                // Often enough for Poki to see that the keyboard is alive.
                if Date().timeIntervalSince(self.lastStatusWrite) > 0.4 { self.writeStatus() }
            }, composing: { [weak self] letters in
                self?.model.composing = letters
            })
            self.finish(outcome)
        }
    }

    private func finish(_ outcome: KeyboardTypist.Outcome) {
        typist = nil
        status.typed = outcome.typed
        status.total = outcome.total
        status.check = outcome.check
        status.tail = outcome.tail
        status.moved = outcome.moved
        status.visible = visible
        if tookOver {
            status.phase = .takeover
            status.note = "the owner tapped Take Over"
        } else if outcome.finished {
            status.phase = .done
        } else {
            status.phase = .stopped
            status.note = cancelled ? "Poki cancelled the typing" : "the keyboard was closed or changed while typing"
        }
        writeStatus()
        model.composing = ""
        refreshMode()
        if tookOver {
            leave(asked: true)
        } else if visible {
            scheduleLeave(after: Self.lingerSeconds)
        }
    }

    /// The owner wants the field: stop at once, and give them their keyboard.
    private func takeOver() {
        guard let typist else { return }
        tookOver = true
        typist.stop()
    }

    // MARK: Leaving

    private func scheduleLeave(after seconds: Double) {
        leaveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.leave() }
        leaveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    /// To the next keyboard, once for each time the panel comes up, and never in the middle of typing.
    /// By itself (`asked` false) it does not leave while a task of Poki's is under way: it looks again
    /// when that task's hold runs out.
    private func leave(asked: Bool = false) {
        leaveWork?.cancel()
        guard visible, !left, typist == nil else { return }
        if !asked, let until = heldUntil {
            model.held = true
            scheduleLeave(after: max(1, until.timeIntervalSinceNow + 0.5))
            return
        }
        left = true
        advanceToNextInputMode()
    }

    /// A word's Pinyin, as the system romanizes it ("你好" gives "nǐ hǎo").
    private static func pinyin(_ word: String) -> String? {
        word.applyingTransform(.mandarinToLatin, reverse: false)
    }

    /// A run of Chinese as words, the units a Pinyin keyboard commits.
    private static func words(_ text: String) -> [String] {
        let tokenizer = NLTokenizer(unit: .word)
        tokenizer.setLanguage(.simplifiedChinese)
        tokenizer.string = text
        var cursor = text.startIndex
        var result: [String] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            if cursor < range.lowerBound { result.append(String(text[cursor..<range.lowerBound])) }
            result.append(String(text[range]))
            cursor = range.upperBound
            return true
        }
        if cursor < text.endIndex { result.append(String(text[cursor...])) }
        return result
    }
}
