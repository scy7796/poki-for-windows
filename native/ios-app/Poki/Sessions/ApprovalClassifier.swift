import Foundation
import PiSwiftAI

/// Agents › Approvals. A step PokiCore's rules hold back (a payment, a message, a delete) is answered
/// one of three ways, by the two selectors there:
/// - Sensitivity Permissive, Balanced or Strict: in Poki's own chat and live call the chat model checks
///   the step against what the owner said, and allows it or not (auto-approval). The chat shows the
///   decision on a card and the Activity Log keeps it.
/// - A step the model did not allow, and every step at Ask for Everything, is the owner's: With Message
///   Reply, the step is refused and the agent asks in words, and the owner's yes in the chat (or in the
///   notification's reply field) lets the next try through; With Confirmation, an Allow / Don't Allow
///   card, on the Live Activity, in a notification or in the chat.
/// - An outside agent's step is always a confirmation: nothing the owner said is there to judge it by,
///   and there is no chat to answer in. The same with no chat model set up.
/// A tap anywhere is not taken as the owner's intent.
@MainActor
enum ApprovalClassifier {
    nonisolated static let onKey = "approvals.classifier"
    nonisolated static let levelKey = "approvals.classifier.level"
    nonisolated static let modeKey = "approvals.mode"

    /// How the owner is asked. `off` keeps the rules off: read when Poki starts.
    enum Mode: String, CaseIterable, Identifiable {
        case reply, confirm, off
        var id: String { rawValue }
        var title: String {
            switch self {
            case .reply: String(localized: "With Message Reply")
            case .confirm: String(localized: "With Confirmation")
            case .off: String(localized: "Never")
            }
        }
    }

    /// The saved choice; before there was one, what the two older switches said.
    nonisolated static var mode: Mode {
        let defaults = UserDefaults.standard
        if let raw = defaults.string(forKey: modeKey), let mode = Mode(rawValue: raw) { return mode }
        let asked = defaults.object(forKey: "approvals.ask") as? Bool ?? true
        let classifier = defaults.object(forKey: onKey) as? Bool
        if !asked, classifier != true { return .off }
        return classifier == false ? .confirm : .reply
    }

    /// A chat model with a key: without one there is nobody to ask.
    static var hasModel: Bool {
        let provider = ModelKeys.selectedProvider
        return provider.wired && (ModelKeys.key(provider) != nil || provider == .custom) && provider.piModel(ModelKeys.selectedModel) != nil
    }

    /// Who answers an approval first.
    enum Route: Equatable {
        /// Asking is off.
        case allow
        /// The chat model; `reply`: its no is final and the agent asks in words, else the owner gets a card.
        case model(reply: Bool)
        /// The owner, on a card.
        case owner
    }

    /// Settled once per approval, when it is first asked, so the app and the chat read the same answer.
    private static var routes: [String: Route] = [:]
    /// Approvals the model did not allow that went on to the owner's card.
    private(set) static var handed: Set<String> = []

    static func route(_ approval: PendingApproval, voiceOn: Bool) -> Route {
        if let known = routes[approval.id] { return known }
        let mode = Self.mode
        let own = AskPoki.chat?.running == true || voiceOn
        let reply = mode == .reply && own
        let route: Route
        if mode == .off { route = .allow }
        else if own, hasModel, reply || Level.saved != .everything { route = .model(reply: reply) }
        else { route = .owner }
        if routes.count > 200 { routes.removeAll(); handed.removeAll() }
        routes[approval.id] = route
        return route
    }

    static func handToOwner(_ id: String) { handed.insert(id) }

    /// The model's answer stood for this approval (it was not passed on to the owner).
    static func modelAnswered(_ id: String) -> Bool {
        if case .model = routes[id], !handed.contains(id) { return verdicts[id] != nil }
        return false
    }

    static let deadline: Double = 12

    enum Level: String, CaseIterable, Identifiable {
        case permissive, balanced, strict, everything
        var id: String { rawValue }
        var title: String {
            switch self {
            case .strict: String(localized: "Strict")
            case .balanced: String(localized: "Balanced")
            case .permissive: String(localized: "Permissive")
            case .everything: String(localized: "Ask for Everything")
            }
        }
        static var saved: Level { Level(rawValue: UserDefaults.standard.string(forKey: levelKey) ?? "") ?? .balanced }
        var rule: String {
            switch self {
            case .strict: "ALLOW only if the owner explicitly asked for this exact action, or said yes when asked about it. Otherwise REFUSE."
            case .balanced: "ALLOW if the action directly serves what the owner asked for in this conversation. REFUSE if it is unrelated, goes further than the request, or the owner said no."
            case .permissive: "ALLOW unless the action is clearly unrelated to what the owner asked, or the owner said no or not to do it."
            // No auto-approval: only the owner's own yes to this step lets it through.
            case .everything: "ALLOW only if the owner answered yes to a question about this exact step in this conversation. Their original request alone is never enough. Otherwise REFUSE."
            }
        }
    }

    struct Verdict { let allowed: Bool; let reason: String }

    /// The latest decisions by approval id, for the chat's grey line.
    private(set) static var verdicts: [String: Verdict] = [:]

    static func decide(_ approval: PendingApproval, level: Level, voice: [VoiceLine]) async -> Verdict {
        let verdict = await ask(approval, level: level, voice: voice)
        verdicts[approval.id] = verdict
        if verdicts.count > 50 { verdicts.removeAll() }
        return verdict
    }

    private static func ask(_ approval: PendingApproval, level: Level, voice: [VoiceLine]) async -> Verdict {
        let provider = ModelKeys.selectedProvider
        guard provider.wired, ModelKeys.key(provider) != nil || provider == .custom,
              let model = provider.piModel(ModelKeys.selectedModel) else {
            return Verdict(allowed: false, reason: "no chat model to ask")
        }
        var said: [String] = AskPoki.chat?.ownerContext ?? []
        for line in voice.suffix(12) {
            switch line.role {
            case .you: said.append("Owner (live call): \(line.text)")
            case .poki: said.append("Assistant (live call): \(line.text)")
            default: break
            }
        }
        let conversation = said.isEmpty ? "(the owner has said nothing in Poki; the request came from an outside agent)" : said.suffix(20).joined(separator: "\n")
        let instructions = """
        You decide, fast, whether an AI agent driving the owner's iPhone may do one sensitive step. \
        \(level.rule) A yes from the owner to a question about this step counts as asking for it. \
        Reply with one line: ALLOW or REFUSE, a colon, and at most ten words why.
        """
        let prompt = """
        Step: \(approval.summary) in \(approval.app) (\(approval.reason)).
        Conversation, oldest first:
        \(String(conversation.suffix(4000)))
        """
        let loop = PiLoop(provider: provider, model: model, tools: []) { _ in
            .init(text: "No tools.", jpeg: nil, isError: true)
        }
        // The first of the model's reply and the deadline answers; a late reply is dropped.
        let reply: String? = await withCheckedContinuation { (done: CheckedContinuation<String?, Never>) in
            let once = Once(done)
            let run = Task { @MainActor in
                var first: String?
                _ = await loop.run(prompt, instructions: instructions, maxTurns: 1) { text in if first == nil { first = text } }
                once.finish(first)
            }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(deadline))
                run.cancel()
                once.finish(nil)
            }
        }
        guard let text = reply?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            return Verdict(allowed: false, reason: "the model did not answer in time")
        }
        let line = text.split(separator: "\n").first.map(String.init) ?? text
        let allowed = line.uppercased().hasPrefix("ALLOW")
        let why = line.split(separator: ":", maxSplits: 1).dropFirst().first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        return Verdict(allowed: allowed, reason: why.isEmpty ? (allowed ? "allowed" : "refused") : String(why.prefix(120)))
    }

}

/// Resumes a continuation once.
@MainActor
private final class Once {
    private var continuation: CheckedContinuation<String?, Never>?
    init(_ continuation: CheckedContinuation<String?, Never>) { self.continuation = continuation }
    func finish(_ value: String?) { continuation?.resume(returning: value); continuation = nil }
}
