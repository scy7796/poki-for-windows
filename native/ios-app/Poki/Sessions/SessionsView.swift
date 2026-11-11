import SwiftUI
import UIKit

/// Poki's home: every conversation, like the Messages list. The owner's chats with Poki, the sessions of
/// outside agents (Claude, Codex, any MCP client) and the tasks they handed to Poki, live first. On top,
/// a strip with one half for each way of using Poki: the address agents connect to, and Poki's own model.
struct SessionsView: View {
    @Environment(AppModel.self) private var model
    @Environment(ChatModel.self) private var chat
    var openChat: () -> Void
    var openSession: (String) -> Void
    var openModel: () -> Void
    var openConnectors: () -> Void
    var openDetails: () -> Void
    var openVoice: () -> Void
    var openSetup: () -> Void
    @State private var copied = false
    @State private var query = ""
    @State private var renaming: SavedSession?
    @State private var newName = ""

    private var store: SessionStore { SessionStore.shared }

    var body: some View {
        List {
            // What matters before any conversation: whether Poki is on, whether agents can reach it,
            // and what setup still needs.
            // One warning while Poki can't work fully, naming where to fix it (the tab bar dots match).
            if setupLeft > 0 || agentsIssue != nil {
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Poki can’t work fully yet").font(Prominent.font(.headline, .semibold))
                            Text("Fix the items below. Each one has a dot on its tab.")
                                .font(.subheadline).foregroundStyle(Color(.secondaryLabel))
                        }
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    }
                    if setupLeft > 0 {
                        Button(action: openSetup) {
                            LabeledContent {
                                Text(setupLeft == 1 ? String(localized: "1 item") : String(localized: "\(setupLeft) items"))
                            } label: {
                                Label("Setup", systemImage: "checklist")
                            }
                        }
                        .foregroundStyle(Color(.label))
                    }
                    if let issue = agentsIssue {
                        Button(action: ModelKeys.hasUsableKey ? openConnectors : openModel) {
                            LabeledContent {
                                Text(issue)
                            } label: {
                                Label("Agents", systemImage: "point.3.connected.trianglepath.dotted")
                            }
                        }
                        .foregroundStyle(Color(.label))
                    }
                }
            }
            if let warning = ExpiryWarning(expiry: model.signer.expiry) {
                ExpiryWarningSection(warning: warning)
            }
            if store.ordered.isEmpty {
                // In the list, under the controls (an overlay would sit on top of them).
                Section {
                    ContentUnavailableView {
                        Label("No Sessions Yet", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Start a chat with Poki, or connect an agent such as Claude or Codex in Agents. Every session shows up here.")
                    }
                    .listRowBackground(Color.clear)
                }
            }
            Section {
                ForEach(shown) { session in
                    Button { open(session) } label: { SessionRow(session: session) }
                        .buttonStyle(.plain)
                        .swipeActions {
                            if !session.live {
                                Button(role: .destructive) { store.delete(session.id) } label: { Label("Delete", systemImage: "trash") }
                            }
                            Button { startRename(session) } label: { Label("Rename", systemImage: "pencil") }
                                .tint(.blue)
                        }
                        .contextMenu {
                            Button { startRename(session) } label: { Label("Rename", systemImage: "pencil") }
                            if !session.live {
                                Button(role: .destructive) { store.delete(session.id) } label: { Label("Delete", systemImage: "trash") }
                            }
                        }
                }
            }
            if !query.isEmpty, shown.isEmpty {
                ContentUnavailableView.search(text: query).listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        // The grouped list leaves a section's worth of space above its first row; under the search
        // field that read as a hole.
        .contentMargins(.top, 6, for: .scrollContent)
        // Home's own header: a soft translucent blue that fades into the list, the bear and "Poki" in
        // Geist at the top left. The other pages keep the system's plain bars.
        .scrollContentBackground(.hidden)
        .background {
            ZStack(alignment: .top) {
                Color(.systemGroupedBackground)
                LinearGradient(colors: [Color.blue.opacity(0.30), Color.blue.opacity(0.10), Color.blue.opacity(0)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 320)
            }
            .ignoresSafeArea()
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: Text("Search Sessions"))
        .navigationTitle(Text(verbatim: "Poki"))
        .navigationBarTitleDisplayMode(.inline)
        // The system title gives way to HomeBrand; "Poki" stays the back button's title.
        .toolbar(removing: .title)
        .toolbar {
            HomeBrand()
            ToolbarItem(placement: .topBarTrailing) {
                PowerButton(state: !model.setupLooksComplete ? .paused : model.sessionOn ? .ready : .stopped,
                            turnOn: { model.startSession() }, turnOff: { chat.stop(); model.stopSession() }, openSetup: openSetup)
            }
        }
        .alert("Rename Session", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) { renaming = nil }
            Button("Save") {
                if let session = renaming { store.rename(session.id, to: newName) }
                renaming = nil
            }
        }
        // A new chat with Poki's own agent, at the bottom right. On iOS 26 it is the round button on
        // the tab bar's line instead (RootView's New Chat tab).
        .safeAreaInset(edge: .bottom, alignment: .trailing, spacing: 0) {
            if #unavailable(iOS 26.0) { newChatButton }
        }
    }

    private var newChatButton: some View {
            Button { chat.newConversation(); openChat() } label: {
                Image(systemName: "square.and.pencil").font(.title3.weight(.semibold))
                    .frame(width: 28, height: 28)
            }
            .newChatStyle()
            .controlSize(.large)
            .fixedSize()
            .disabled(chat.running)
            .padding(.trailing, 16).padding(.bottom, 8)
            .accessibilityLabel(Text("New Chat with Poki"))
    }

    /// "Working in Messages", "Ready", "Off".
    private var runLine: String {
        if chat.running { return model.currentApp.map { String(localized: "Working in \($0)") } ?? String(localized: "Working") }
        if !model.sessionOn { return String(localized: "Off. Agents and chats can’t use this iPhone.") }
        if model.runnerPaused { return String(localized: "Paused") }
        return String(localized: "On, ready for a task")
    }

    private var agentsLine: String {
        let live = SessionStore.shared.liveAgentCount
        switch model.relayStatus {
        case .ready: return live > 0 ? String(localized: "Online · \(live) live") : String(localized: "Online")
        case .connecting: return String(localized: "Connecting")
        case .offline: return String(localized: "Offline")
        case .off: return model.identity.secrets.isEmpty ? String(localized: "None yet") : String(localized: "Off")
        }
    }

    private var needsSetup: Bool { model.pairingPath == nil || model.setupStepsLeft }

    private var setupLeft: Int { model.setupLooksComplete ? 0 : SetupStep.shown.filter { !model.looksDone($0) }.count }

    /// What the Agents tab needs, if anything (the same test as its tab bar dot).
    private var agentsIssue: String? {
        if !ModelKeys.hasUsableKey { return String(localized: "No chat account") }
        if case .offline = model.relayStatus { return String(localized: "Relay offline") }
        return nil
    }

    /// The sessions matching the search field: name, first message or last line.
    private var shown: [SavedSession] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return store.ordered }
        return store.ordered.filter { [$0.name, $0.title, $0.lastLine, $0.client ?? ""].contains { $0.localizedCaseInsensitiveContains(q) } }
    }

    private func startRename(_ session: SavedSession) {
        newName = session.name
        renaming = session
    }

    private func open(_ session: SavedSession) {
        if session.kind == .poki {
            if session.id != chat.sessionID { chat.restore(session) }
            openChat()
        } else {
            openSession(session.id)
        }
    }

}

extension View {
    /// The line under the title (iOS 26's navigation subtitle); nothing before iOS 26.
    @ViewBuilder func sessionSubtitle(_ text: String) -> some View {
        if #available(iOS 26.0, *), !text.isEmpty { navigationSubtitle(Text(verbatim: text)) } else { self }
    }
}

private extension View {
    /// The state pill: a fixed-width capsule filled with the state's colour (iOS 26's prominent toolbar
    /// button, which takes the place of the bar's glass rather than sitting on it; a prominent capsule
    /// before iOS 26).
    @ViewBuilder func powerStyle(tint: Color) -> some View {
        if #available(iOS 26.0, *) { buttonStyle(.glassProminent).buttonBorderShape(.capsule).tint(tint) }
        else { buttonStyle(.borderedProminent).buttonBorderShape(.capsule).tint(tint) }
    }

    /// Blue-tinted Liquid Glass on iOS 26 and later; a blue prominent capsule before it.
    @ViewBuilder func newChatStyle() -> some View {
        if #available(iOS 26.0, *) { buttonStyle(.glassProminent).buttonBorderShape(.circle).tint(.blue) }
        else { buttonStyle(.borderedProminent).buttonBorderShape(.circle).tint(.blue) }
    }
}

/// The home page's title: the bear and "Poki" in Geist, at the top left in place of the system title,
/// without the toolbar's glass behind it on iOS 26.
struct HomeBrand: ToolbarContent {
    var body: some ToolbarContent {
        if #available(iOS 26.0, *) {
            ToolbarItem(placement: .topBarLeading) { label }
                .sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: .topBarLeading) { label }
        }
    }

    private var label: some View {
        HStack(spacing: 10) {
            Image("Bear").resizable().scaledToFill()
                .frame(width: 34, height: 34)
                .clipShape(.rect(cornerRadius: 9, style: .continuous))
                .shadow(color: .blue.opacity(0.35), radius: 6, y: 2)
            Text(verbatim: "Poki")
                .font(Prominent.font(.title, .bold))
                .foregroundStyle(.primary)
        }
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "Poki"))
        .accessibilityAddTraits(.isHeader)
    }
}

/// Poki's state as a fixed-width pill at the top right: Ready (blue, on; a tap turns it off), Stopped
/// (red, off; a tap turns it on), Paused (orange, a setup item is open; a tap opens Setup). Words as
/// well as colours, so the state reads without colour. A haptic for each turn.
struct PowerButton: View {
    enum Status { case ready, stopped, paused }
    var state: Status
    var turnOn: () -> Void
    var turnOff: () -> Void
    var openSetup: () -> Void

    var body: some View {
        Button {
            switch state {
            case .ready:
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                turnOff()
            case .stopped:
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                turnOn()
            case .paused:
                // A setup item is open: the fix is there, not in turning on.
                openSetup()
            }
        } label: {
            // The state's symbol before its word, a touch taller than the text, in a pill of fixed width.
            HStack(spacing: 5) {
                Image(systemName: symbol)
                    .font(.body.weight(.semibold))
                    .imageScale(.medium)
                    .contentTransition(.symbolEffect(.replace))
                Text(word)
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .contentTransition(.interpolate)
            }
            .frame(width: 96)
        }
        .powerStyle(tint: tint)
        .animation(.snappy, value: state)
        .accessibilityLabel(Text("Poki"))
        .accessibilityValue(Text(word))
        .accessibilityHint(Text(state == .ready ? "Turns Poki off" : state == .stopped ? "Turns Poki on" : "Opens Setup"))
    }

    private var word: LocalizedStringKey {
        switch state {
        case .ready: "Ready"
        case .stopped: "Stopped"
        case .paused: "Paused"
        }
    }

    private var symbol: String {
        switch state {
        case .ready: "checkmark.circle.fill"
        case .stopped: "power"
        case .paused: "exclamationmark.triangle.fill"
        }
    }

    private var tint: Color {
        switch state {
        case .ready: .blue
        case .stopped: .red
        case .paused: .orange
        }
    }
}

/// One row: who, when, the last thing that happened, and how it ended.
struct SessionRow: View {
    var session: SavedSession

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            SessionAvatar(session: session, size: 44)
                .overlay(alignment: .topTrailing) {
                    if session.live {
                        Circle().fill(ChatColor.green).frame(width: 12, height: 12)
                            .overlay(Circle().strokeBorder(Color(.systemBackground), lineWidth: 2))
                            .offset(x: 2, y: -2)
                            .accessibilityLabel(Text("Live"))
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: session.name).font(Prominent.font(.body, .semibold)).foregroundStyle(Color(.label)).lineLimit(1)
                    Spacer(minLength: 6)
                    Text(session.live ? String(localized: "now") : ChatTime.row(session.updated)).font(.system(size: 15)).foregroundStyle(ChatColor.secondary)
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Color(.tertiaryLabel))
                }
                HStack(spacing: 4) {
                    outcomeMark
                    Text(verbatim: subtitle).font(.system(size: 15)).foregroundStyle(ChatColor.secondary).lineLimit(2)
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let line = session.lastLine
        if session.kind != .poki, line.isEmpty { return session.title }
        return line
    }

    @ViewBuilder private var outcomeMark: some View {
        switch session.outcome {
        case .failed?: Image(systemName: "exclamationmark.circle.fill").font(.system(size: 13)).foregroundStyle(Color(.systemOrange))
        case .stopped?: Image(systemName: "pause.circle.fill").font(.system(size: 13)).foregroundStyle(ChatColor.secondary)
        default: EmptyView()
        }
    }
}

/// Poki's bear for its own chats; the agent's initial on its colour for an outside agent; both for a
/// hand-off.
struct SessionAvatar: View {
    var session: SavedSession
    var size: CGFloat

    var body: some View {
        switch session.kind {
        case .poki: PokiAvatar(size: size)
        case .voice:
            ZStack(alignment: .bottomTrailing) {
                PokiAvatar(size: size)
                Image(systemName: "waveform.circle.fill").font(.system(size: size * 0.42)).symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Color.blue).background(Circle().fill(Color(.systemBackground)).padding(-1.5))
                    .offset(x: 3, y: 3).accessibilityHidden(true)
            }
        case .agent: AgentBadge(name: session.client ?? "", size: size)
        case .handoff:
            ZStack(alignment: .bottomTrailing) {
                AgentBadge(name: session.client ?? "", size: size)
                PokiAvatar(size: size * 0.5).overlay(Circle().strokeBorder(Color(.systemBackground), lineWidth: 2))
                    .offset(x: 3, y: 3)
            }
        }
    }
}

/// An outside agent's badge: its provider's logo, or its initials (see `CallerBadge`).
struct AgentBadge: View {
    var name: String
    var size: CGFloat
    var body: some View { CallerBadge(name: name, size: size).accessibilityHidden(true) }
}

/// An outside agent's session or hand-off as a conversation: the agent's own steps as grey lines, its
/// request and Poki's answer as bubbles. Live while the session runs.
struct SessionView: View {
    @Environment(AppModel.self) private var model
    var id: String
    var back: () -> Void

    @State private var renaming = false
    @State private var newName = ""

    var body: some View {
        let session = SessionStore.shared.session(id)
        ChatTranscript(entries: (AskPoki.live(id)?.entries ?? session?.entries) ?? [], typing: AskPoki.live(id)?.awaitingModel ?? false, canRetry: false, retry: {}, session: id) {
            if session?.live == true, let approval = model.approvals.first {
                ApprovalCard(approval: approval) { approved in model.resolve(approval, approved: approved) }
            }
        }
        // Stop sits on the bottom edge as an inset, so the bubbles scroll under it and the bars keep
        // their scroll-edge behaviour (as in the chat).
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if AskPoki.live(id) != nil {
                Button("Stop Poki") { AskPoki.live(id)?.stop() }.buttonStyle(.bordered).tint(Color(.systemRed)).padding(.vertical, 10)
            }
        }
        .background(Color(.systemBackground))
        // The session's name is the title; its menu renames it (the system title menu).
        .navigationTitle(Text(verbatim: session?.name ?? ""))
        .navigationBarTitleDisplayMode(.inline)
        .sessionSubtitle(caption(session))
        .toolbarTitleMenu {
            Button("Rename", systemImage: "pencil") { newName = session?.name ?? ""; renaming = true }
        }
        .alert("Rename Session", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Save") { SessionStore.shared.rename(id, to: newName) }
        }
    }

    private func caption(_ session: SavedSession?) -> String {
        guard let session else { return "" }
        switch session.kind {
        case .agent: return String(localized: "Over MCP · \(ChatTime.row(session.started))")
        case .handoff: return String(localized: "Handed to Poki · \(ChatTime.row(session.started))")
        case .voice: return String(localized: "Voice · \(ChatTime.row(session.started))")
        case .poki: return ""
        }
    }
}

/// An approval waiting for the owner, in the chat and in the session that asked for it (also in the
/// Dynamic Island, which iOS hides while Poki is in front).
struct ApprovalCard: View {
    var approval: PendingApproval
    var answer: (Bool) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Allow this step?").font(.system(size: 15, weight: .semibold))
            Text(verbatim: approval.summary).font(.system(size: 15)).foregroundStyle(Color(.label))
            HStack {
                Button("Don’t Allow") { answer(false) }.buttonStyle(.bordered)
                Button("Allow") { answer(true) }.buttonStyle(.borderedProminent)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16, style: .continuous))
        .padding(.top, 8)
    }
}
