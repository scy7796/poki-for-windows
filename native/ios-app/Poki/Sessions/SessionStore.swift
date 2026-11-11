import Foundation
import PokiCore
import SwiftUI

/// One conversation in the Sessions list: an in-app chat with Poki, an outside agent's MCP session
/// (its own look and do calls), or a task an outside agent handed to Poki (`ask_poki`).
struct SavedSession: Codable, Identifiable, Equatable {
    enum Kind: String, Codable { case poki, agent, handoff, voice }
    enum Outcome: String, Codable { case done, failed, stopped }

    var id: String
    var kind: Kind
    /// The outside agent's display name ("Claude", "Codex"), for `.agent` and `.handoff`.
    var client: String?
    var title: String
    var started: Date
    var updated: Date
    var live: Bool
    var outcome: Outcome?
    var entries: [ChatEntry]
    var calls: [CallRecord]
    /// The owner's own name for it (Rename), and the short name Poki's chat model gave it.
    var customName: String? = nil
    var autoName: String? = nil
    /// sha256 of the connector secret an outside agent's session came through (the relay says).
    var connector: String? = nil

    /// The row's second line: the last thing that happened, as plain text (markdown neither drawn nor
    /// shown as its marks).
    var lastLine: String { Self.plain(rawLastLine) }

    /// Markdown to plain text: inline marks dropped, headings, list bullets, quotes and code fences
    /// stripped, links reduced to their text, lines joined.
    static func plain(_ markdown: String) -> String {
        let lines = markdown.split(separator: "\n", omittingEmptySubsequences: true).compactMap { raw -> String? in
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") { return nil }
            while line.hasPrefix("#") || line.hasPrefix(">") { line.removeFirst(); line = line.trimmingCharacters(in: .whitespaces) }
            for bullet in ["- ", "* ", "+ "] where line.hasPrefix(bullet) { line.removeFirst(2) }
            if let match = line.firstMatch(of: #/^\d+[.)]\s+/#) { line.removeSubrange(match.range) }
            let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
            if let attributed = try? AttributedString(markdown: line, options: options) { line = String(attributed.characters) }
            return line.isEmpty ? nil : line
        }
        return lines.joined(separator: " ")
    }

    private var rawLastLine: String {
        for entry in entries.reversed() {
            switch entry.kind {
            case .poki(let text): return text
            case .you(let text, _), .request(let text, _): return text
            case .step(let text, let ok): return ok == false ? String(localized: "\(text), failed") : text
            case .plan(let steps):
                if let step = steps.last(where: { $0.state == .waiting }) { return String(localized: "\(step.text) · waiting for you") }
                if let step = steps.last { return step.text }
            case .note(.waiting): return String(localized: "Waiting for your OK")
            case .note(.problem(let text)): return text
            default: continue
            }
        }
        return ""
    }

    /// "Claude → Poki" for a hand-off, the agent's name for its own session, "Poki" for a chat.
    var name: String {
        if let customName, !customName.isEmpty { return customName }
        switch kind {
        case .poki: return autoName ?? (title == String(localized: "New conversation") ? "Poki" : String(title.prefix(40)))
        case .agent: return client ?? String(localized: "An agent")
        case .handoff: return autoName.map { "\(client ?? String(localized: "An agent")) · \($0)" } ?? "\(client ?? String(localized: "An agent")) → Poki"
        case .voice: return autoName ?? (title.isEmpty ? String(localized: "Voice chat") : String(title.prefix(40)))
        }
    }
}

/// The saved sessions, newest first, one JSON file each in Application Support/Poki/Sessions. They stay on
/// this iPhone; the routines thread's backup can carry them (`all()` / `restore(_:)`). At most 200 are kept.
@MainActor
@Observable
final class SessionStore {
    static let shared = SessionStore()
    static let limit = 200
    /// An outside agent's session with no call for this long is over (most clients never send DELETE).
    static let agentIdle: TimeInterval = 10 * 60

    private(set) var sessions: [SavedSession] = []
    private let folder: URL
    private var pendingWrites: Set<String> = []
    private var writeTask: Task<Void, Never>?
    /// The outside agent sessions seen since launch: id → client name.
    /// Each MCP session's client name (its clientInfo at initialize), kept across launches: an agent
    /// keeps its session while Poki restarts or the session is closed for being idle, and its next
    /// call (ask_poki among them) still says who it is.
    private var clients: [String: String] = (UserDefaults.standard.dictionary(forKey: "sessions.clients") as? [String: String]) ?? [:] {
        didSet {
            var kept = clients
            if kept.count > 200 { kept = Dictionary(uniqueKeysWithValues: kept.suffix(200).map { ($0.key, $0.value) }) }
            UserDefaults.standard.set(kept, forKey: "sessions.clients")
        }
    }
    /// The last outside client that gave its name at initialize, kept across launches.
    private var lastClient: String? = UserDefaults.standard.string(forKey: "sessions.lastClient") {
        didSet { UserDefaults.standard.set(lastClient, forKey: "sessions.lastClient") }
    }
    /// The agent (or the owner's name) of a connector, by the sha256 of its secret; set by AppModel.
    var connectorAgent: ((String) -> String?)?
    /// The connector each outside agent session came through: id → sha256 of its secret.
    private var connectors: [String: String] = [:]
    /// The session whose call is running, for approvals and hand-offs (they carry no session).
    private var currentSession: String?
    /// The outside agent session whose call is running, if any.
    var activeSessionID: String? { currentSession }

    private init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? URL(fileURLWithPath: NSTemporaryDirectory())
        folder = base.appendingPathComponent("Poki/Sessions", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        if UserDefaults.standard.bool(forKey: "pokiSample") || UserDefaults.standard.string(forKey: "pokiSessions") != nil {
            sessions = Self.samples()
            return
        }
        load()
    }

    private func load() {
        let decoder = JSONDecoder()
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        var loaded = files.filter { $0.pathExtension == "json" }.compactMap { url in
            (try? Data(contentsOf: url)).flatMap { try? decoder.decode(SavedSession.self, from: $0) }
        }
        // Nothing is live after a relaunch.
        for i in loaded.indices where loaded[i].live { loaded[i].live = false; loaded[i].outcome = loaded[i].outcome ?? .stopped }
        sessions = loaded.sorted { $0.updated > $1.updated }
        trim()
    }

    func session(_ id: String) -> SavedSession? { sessions.first { $0.id == id } }

    /// The latest in-app chat, to come back to at launch.
    func latestPoki() -> SavedSession? { sessions.first { $0.kind == .poki } }

    /// Live first, then newest.
    var ordered: [SavedSession] {
        sessions.sorted { a, b in a.live != b.live ? a.live : a.updated != b.updated ? a.updated > b.updated : a.id < b.id }
    }

    var liveAgentCount: Int { sessions.filter { $0.live && ($0.kind == .agent || $0.kind == .handoff) }.count }

    // MARK: Chats

    func save(chat: ChatModel) {
        let saved = self.session(chat.sessionID)
        var session = saved ?? SavedSession(id: chat.sessionID, kind: chat.kind, client: chat.requester, title: chat.title,
                                            started: Date(), updated: Date(), live: false, outcome: nil, entries: [], calls: [])
        let changed = saved == nil || session.entries != chat.entries
        session.entries = chat.entries
        session.calls = chat.savedCalls
        session.title = chat.title
        if let name = pendingNames.removeValue(forKey: chat.sessionID) { session.autoName = name }
        // Opening a conversation hands the same lines back: only a new line gives the row a new time
        // and moves it up the list. (It used to jump to the top, marked "now", each time it was opened.)
        if changed { session.updated = Date() }
        session.live = chat.running
        guard session != saved else { return }
        put(session)
    }

    /// A live voice conversation (Realtime): what was said and the steps it took, as a read-only
    /// transcript in the list. Hold-to-dictate turns go through the chat and are saved with it.
    func save(voice id: String, started: Date, lines: [VoiceLine], live: Bool) {
        var session = self.session(id) ?? SavedSession(id: id, kind: .voice, client: nil, title: "", started: started, updated: Date(),
                                                         live: live, outcome: nil, entries: [], calls: [])
        guard session.kind == .voice else { return }
        let entries = Self.entries(voice: lines, started: started)
        // Nothing said yet: no row.
        guard entries.count > 1 || self.session(id) != nil else { return }
        session.entries = entries
        if session.title.isEmpty, let first = lines.first(where: { $0.role == .you }) { session.title = first.text }
        session.live = live
        if !live, session.outcome == nil { session.outcome = .done }
        session.updated = Date()
        put(session)
    }

    func taskEnded(_ id: String, success: Bool?, stopped: Bool) {
        guard var session = session(id) else { return }
        session.live = false
        session.outcome = stopped ? .stopped : success == false ? .failed : .done
        session.updated = Date()
        put(session)
    }

    /// Outside agents' sessions that came through a connector, newest first. The relay names the
    /// connector of each request (the sha256 of its secret); a hand-off belongs to the connector of
    /// the agent session that asked. Sessions from before the relay said fall back to a name match
    /// ("Claude" and "Claude Code"), or with a single connector, all of them.
    func sessions(for connector: ConnectorSecret, among all: [ConnectorSecret]) -> [SavedSession] {
        let outside = ordered.filter { $0.kind == .agent || $0.kind == .handoff }
        let hash = connector.hash
        let name = connector.name.lowercased()
        return outside.filter { session in
            if let known = connectorHash(of: session) { return known == hash }
            if all.count <= 1 { return true }
            let client = (session.client ?? "").lowercased()
            return !client.isEmpty && (client.contains(name) || name.contains(client))
        }
    }

    private func connectorHash(of session: SavedSession) -> String? {
        if let connector = session.connector { return connector }
        guard session.kind == .handoff, let range = session.id.range(of: "-ask-") else { return nil }
        let agent = String(session.id[..<range.lowerBound])
        return connectors[agent] ?? self.session(agent)?.connector
    }

    /// The owner's name for a session; empty goes back to the automatic one.
    func rename(_ id: String, to name: String) {
        guard var session = session(id) else { return }
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        session.customName = name.isEmpty ? nil : String(name.prefix(60))
        put(session)
    }

    /// Names given before the session's first save wait here.
    private var pendingNames: [String: String] = [:]

    /// The short name Poki's chat model gave a chat.
    func setAutoName(_ id: String, _ name: String) {
        guard var session = session(id) else { pendingNames[id] = name; return }
        session.autoName = name
        put(session)
    }

    /// A live voice conversation as chat entries: its start time, your words, Poki's answers, its steps.
    /// Each entry keeps the time its line was said, for the saved record (`install-iphone.mjs records`).
    static func entries(voice lines: [VoiceLine], started: Date) -> [ChatEntry] {
        var time = ChatEntry(.time(started))
        time.at = started
        return [time] + lines.map { line in
            var entry: ChatEntry
            switch line.role {
            case .you: entry = ChatEntry(.you(line.text, delivered: true))
            case .poki: entry = ChatEntry(.poki(line.text))
            case .tool: entry = ChatEntry(.step(line.text, ok: true))
            case .note: entry = ChatEntry(.note(.problem(line.text)))
            }
            entry.at = line.at
            return entry
        }
    }

    func delete(_ id: String) {
        sessions.removeAll { $0.id == id }
        try? FileManager.default.removeItem(at: file(id))
    }

    // MARK: Outside agents

    /// Every PokiCore event, before the screen's own handling: outside agents' sessions and steps.
    func observe(_ event: ShellEvent, approvals: [PendingApproval]) {
        switch event {
        case .session(.started(let id, let client, _, let connector)):
            if client.isEmpty {
                // A session that began before Poki last started: named from the connector's agent,
                // else the last client that said its name.
                if clients[id] == nil, let name = connector.flatMap({ connectorAgent?($0) }) ?? lastClient { clients[id] = AgentName.pretty(name) }
            } else {
                clients[id] = AgentName.pretty(client)
                lastClient = client
            }
            if let connector { connectors[id] = connector }
        case .session(.ended(let id)):
            if var session = session(id), session.live {
                session.live = false
                session.outcome = session.outcome ?? .done
                session.updated = Date()
                put(session)
            }
        case .toolStarted(_, let summary, let id?):
            currentSession = id
            update(agent: id) { session in
                session.entries.append(ChatEntry(.step(summary, ok: nil)))
            }
        case .toolFinished(let summary, let delivery, _, _, _, let id?):
            let failed = delivery.hasPrefix("failed")
            update(agent: id) { session in
                if let i = session.entries.lastIndex(where: { if case .step(_, nil) = $0.kind { return true }; return false }) {
                    session.entries[i].kind = .step(summary, ok: !failed)
                } else {
                    session.entries.append(ChatEntry(.step(summary, ok: !failed)))
                }
                session.outcome = failed ? .failed : nil
            }
        case .toolStarted(_, _, nil), .toolFinished(_, _, _, _, _, nil):
            currentSession = nil
        case .approvalRequested(let approval):
            guard let id = currentSession, session(id)?.kind == .agent else { return }
            update(agent: id) { $0.entries.append(ChatEntry(.step(String(localized: "Asked you to allow: \(approval.summary)"), ok: nil))) }
        case .approvalEnded(_, let approved):
            guard let id = currentSession, session(id)?.kind == .agent else { return }
            update(agent: id) { $0.entries.append(ChatEntry(.note(approved == true ? .approved(Date()) : approved == false ? .declined : .expired))) }
        case .handoffRequested(_, _, let text, _):
            guard let id = currentSession, session(id)?.kind == .agent else { return }
            update(agent: id) { $0.entries.append(ChatEntry(.step(String(localized: "Your turn: \(text ?? String(localized: "finish this step"))"), ok: nil))) }
        case .relay, .handoffEnded: break
        }
    }

    /// The outside agent's session, made on its first call; a session idle for 10 minutes is over.
    private func update(agent id: String, _ change: (inout SavedSession) -> Void) {
        let client = clients[id] ?? String(localized: "An agent")
        var session = self.session(id) ?? SavedSession(id: id, kind: .agent, client: client, title: client, started: Date(), updated: Date(), live: true,
                                                         outcome: nil, entries: [ChatEntry(.time(Date()))], calls: [])
        // A hand-off's own session is the in-app agent's (its steps come from ChatModel).
        guard session.kind == .agent else { return }
        session.live = true
        session.connector = session.connector ?? connectors[id]
        change(&session)
        session.updated = Date()
        put(session)
        expireIdleAgents()
    }

    private func expireIdleAgents() {
        for session in sessions where session.live && session.kind == .agent && Date().timeIntervalSince(session.updated) > Self.agentIdle {
            var ended = session
            ended.live = false
            ended.outcome = ended.outcome ?? .done
            put(ended)
        }
    }

    /// The hand-off's chat takes the outside session's id, so the agent's own calls and its hand-off
    /// stay apart: the hand-off gets its own row.
    func handoffID(for agentSession: String?) -> String { "\(agentSession ?? "agent")-ask-\(UUID().uuidString.prefix(8).lowercased())" }

    func client(of agentSession: String?) -> String {
        if let id = agentSession, let name = clients[id] { return name }
        if let id = agentSession, let name = connectors[id].flatMap({ connectorAgent?($0) }) { return AgentName.pretty(name) }
        return lastClient.map(AgentName.pretty) ?? String(localized: "An agent")
    }

    // MARK: Routines and backup (dev/agent-routines)

    /// Each session's JSON as stored, for the agent backup file.
    func all() -> [Data] {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return sessions.compactMap { try? encoder.encode($0) }
    }

    /// A session from a backup; the newer copy wins.
    func restore(_ data: Data) throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        var session = try decoder.decode(SavedSession.self, from: data)
        session.live = false
        if let mine = self.session(session.id), mine.updated >= session.updated { return }
        put(session)
    }

    /// The ordered tool calls of a session, for "save a routine from this session".
    func record(_ id: String) -> [CallRecord] { session(id)?.calls ?? [] }

    // MARK: Files

    private func put(_ session: SavedSession) {
        if let i = sessions.firstIndex(where: { $0.id == session.id }) { sessions[i] = session } else { sessions.insert(session, at: 0); trim() }
        guard !UserDefaults.standard.bool(forKey: "pokiSample") else { return }
        pendingWrites.insert(session.id)
        guard writeTask == nil else { return }
        // Writes are gathered for half a second: a task changes its session many times a second.
        writeTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            self?.flush()
        }
    }

    private func flush() {
        writeTask = nil
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .deferredToDate
        for id in pendingWrites {
            guard let session = session(id), let data = try? encoder.encode(session) else { continue }
            try? data.write(to: file(id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        pendingWrites = []
    }

    private func trim() {
        guard sessions.count > Self.limit else { return }
        let sorted = sessions.sorted { $0.updated > $1.updated }
        for old in sorted[Self.limit...] { try? FileManager.default.removeItem(at: file(old.id)) }
        sessions = Array(sorted.prefix(Self.limit))
    }

    private func file(_ id: String) -> URL {
        folder.appendingPathComponent(id.replacingOccurrences(of: "/", with: "_") + ".json")
    }

    // MARK: Screenshots

    /// `-pokiSample YES` or `-pokiSessions sample`: the board's list, for the build's screenshots.
    private static func samples() -> [SavedSession] {
        let now = Date()
        func at(_ minutes: Double) -> Date { now.addingTimeInterval(-minutes * 60) }
        let mom = String(localized: "Text Mom “On my way”, tell me when it’s sent.")
        return [
            SavedSession(id: "sample-handoff", kind: .handoff, client: "Claude", title: mom, started: at(1), updated: at(0), live: true, outcome: nil, entries: [
                ChatEntry(.time(at(1))),
                ChatEntry(.step(String(localized: "Look at the screen"), ok: true)),
                ChatEntry(.step(String(localized: "Tap “Messages”"), ok: true)),
                ChatEntry(.request(mom, from: "Claude")),
                ChatEntry(.plan([PlanStep(String(localized: "Open Messages"), state: .done), PlanStep(String(localized: "Open the chat with Mom"), state: .done),
                                 PlanStep(String(localized: "Type “On my way”"), state: .done), PlanStep(String(localized: "Tap Send"), state: .waiting)])),
                ChatEntry(.note(.waiting)),
            ], calls: []),
            SavedSession(id: "sample-poki", kind: .poki, client: nil, title: String(localized: "What iOS version is this?"), started: at(32), updated: at(31), live: false, outcome: .done, entries: [
                ChatEntry(.time(at(32))),
                ChatEntry(.you(String(localized: "What iOS version is this?"), delivered: true)),
                ChatEntry(.plan([PlanStep(String(localized: "Open Settings"), state: .done), PlanStep(String(localized: "Open General › About"), state: .done)])),
                ChatEntry(.poki(String(localized: "It’s iOS 27.3."))),
            ], calls: []),
            SavedSession(id: "sample-codex", kind: .agent, client: "Codex", title: "Codex", started: at(64), updated: at(61), live: false, outcome: .done, entries: [
                ChatEntry(.time(at(64))), ChatEntry(.step(String(localized: "Open Photos"), ok: true)), ChatEntry(.step(String(localized: "Look at the screen"), ok: true)),
                ChatEntry(.step(String(localized: "Tap “Albums”"), ok: true)),
            ], calls: []),
            SavedSession(id: "sample-cc", kind: .agent, client: "Claude Code", title: "Claude Code", started: at(1500), updated: at(1490), live: false, outcome: .stopped, entries: [
                ChatEntry(.time(at(1500))), ChatEntry(.step(String(localized: "Open the App Store"), ok: true)),
                ChatEntry(.step(String(localized: "Your turn: enter your Apple Account password"), ok: nil)),
            ], calls: []),
        ]
    }
}

/// An MCP client's `clientInfo.name` as people know it.
enum AgentName {
    static func pretty(_ raw: String) -> String {
        let name = raw.lowercased()
        if name.contains("claude-code") || name.contains("claude code") { return "Claude Code" }
        if name.contains("claude") || name.contains("anthropic") { return "Claude" }
        if name.contains("codex") { return "Codex" }
        if name.contains("chatgpt") || name.contains("openai") { return "ChatGPT" }
        if name.contains("cursor") { return "Cursor" }
        if name.contains("gemini") { return "Gemini" }
        if name.contains("poki") { return "Poki Agent" }
        let words = raw.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ").split(separator: " ")
        return words.isEmpty ? String(localized: "An agent") : words.map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }
}
