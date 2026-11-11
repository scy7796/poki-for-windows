import SwiftUI
import UniformTypeIdentifiers

/// Setup, one step per page (ESP-139 board 03). Steps the phone can check by itself (the loopback,
/// pairing, location and Live Activities) move on when they pass; steps it can't (Poki Runner,
/// Developer Mode, UI Automation) keep a switch the person turns on, and Continue lights up after it.
/// Steps that send the person to Settings put the step and what to tap in the Live Activity.
struct SetupView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var index: Int
    private let steps = SetupStep.shown

    init(start: Int) { _index = State(initialValue: start) }

    /// The first step not done, where setup opens.
    @MainActor static func firstOpen(_ model: AppModel) -> Int {
        SetupStep.shown.firstIndex { !model.isDone($0) } ?? 0
    }

    private var step: SetupStep { steps[index] }

    var body: some View {
        SitePage {
            VStack(spacing: 0) {
                header
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(step.pageTitle).site(30, .heavy, line: 36, tracking: -0.02).fixedSize(horizontal: false, vertical: true)
                            Text(step.pageSummary).site(15, line: 21).foregroundStyle(Site.c3).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, 24).padding(.top, 28)
                        VStack(alignment: .leading, spacing: 0) { content }.padding(.bottom, 24)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .id(step)
                    .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        // The button sits in its own bar in the page colour, so a long page (an open proxy app at a
        // larger text size) scrolls up out from under it instead of showing through around it.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            mainButton.padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)
                .frame(maxWidth: .infinity)
                .background(Site.page(scheme).ignoresSafeArea(edges: .bottom))
        }
        .onChange(of: checkedByPhone) { was, now in
            if !was, now, step != .loopback { advanceSoon() }
        }
        // The loopback moves on when it comes on while this page is open, and when the first check after
        // opening finds it already on (a proxy app set up before Poki: the page opened on `checking`).
        .onChange(of: model.loopback.state) { was, now in
            if step == .loopback, !was.isWorking, model.loopback.isWorking { advanceSoon() }
        }
        .onAppear { model.loopback.resume(); reconnectBuiltIn() }
        .onChange(of: step) { _, now in if now == .loopback { reconnectBuiltIn() } }
        // Leaving the pairing step in Poki (another step, or closing setup) stops the pairing and its
        // background keep-alive. Going to Settings is not leaving.
        .onChange(of: index) { old, _ in if steps[old] == .pairing { model.leftPairing() } }
        .onDisappear { model.leftPairing() }
    }

    /// The current step's own check passed: the pairing took, location and Live Activities are on.
    private var checkedByPhone: Bool { step == .pairing || step == .background ? model.isDone(step) : false }

    private var header: some View {
        HStack(spacing: 12) {
            Button { index == 0 ? dismiss() : withAnimation(.snappy) { index -= 1 } } label: {
                Text(verbatim: "‹").site(17, line: 22).frame(minWidth: 20, minHeight: 32, alignment: .leading).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(index == 0 ? Text("Close") : Text("Back"))
            HStack(spacing: 4) {
                ForEach(steps.indices, id: \.self) { i in
                    Capsule().fill(i <= index ? Color.white : Color.white.opacity(0.28)).frame(height: 4)
                }
            }
            .accessibilityHidden(true)
            Text("\(index + 1) of \(steps.count)").site(13, line: 16).foregroundStyle(Site.c4).monospacedDigit()
        }
        .padding(.horizontal, 20).padding(.top, 8)
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .runner:
            InstructionsCard(lines: [
                "Install **Poki Runner** (poki-runner-unsigned.ipa) with the same tool and Apple ID you used for Poki.",
                "Open **Settings › General › VPN & Device Management**, tap your Apple ID, then tap **Trust**.",
                "Don’t open Poki Runner yourself. Poki starts it when an agent needs this iPhone.",
            ])
            SetupFootnote(text: "With a free Apple ID, self-signed apps expire after 7 days and are limited to 3 at a time; Poki and Poki Runner use 2. For free Apple ID signing, install the external-connection build and use LocalDevVPN or a compatible VPN app.")
            ConfirmCard(step: .runner, title: "Poki Runner is installed and trusted", isOn: binding(\.runnerInstalled))
        case .developerMode:
            InstructionsCard(lines: [
                SetupStep.inProcess ? "Open **Settings › Privacy & Security › Developer Mode**." : "Open **Settings › Privacy & Security › Developer Mode**. It appears once Poki Runner is installed.",
                "Turn on Developer Mode, then tap **Restart**.",
                "After restarting, unlock this iPhone and tap **Turn On**.",
            ])
            ConfirmCard(step: .developerMode, title: "Developer Mode is on", isOn: binding(\.developerMode))
        case .loopback: LoopbackPage()
        case .pairing: PairingPage()
        case .automation:
            InstructionsCard(lines: [
                "Open **Settings › Developer**. It appears once Developer Mode is on.",
                "Turn on **Enable UI Automation**.",
            ])
            ConfirmCard(step: .automation, title: "UI Automation is on", isOn: binding(\.uiAutomation))
        case .background: BackgroundPage()
        }
    }

    private func binding(_ key: WritableKeyPath<SetupState, Bool>) -> Binding<Bool> {
        Binding(get: { model.setup[keyPath: key] }, set: { model.setup[keyPath: key] = $0 })
    }

    @ViewBuilder private var mainButton: some View {
        if step == .pairing, let action = PairingPage.mainAction(model) {
            CapsuleButton(title: action.title, height: 54) { action.run(model) }
        } else if index == steps.count - 1 {
            CapsuleButton(title: "Done", height: 54) { dismiss() }
        } else {
            CapsuleButton(title: "Continue", height: 54, enabled: model.isDone(step)) { advance() }
        }
    }

    /// The built-in connection was chosen and set up before, but it goes down whenever Poki is off, so
    /// the step opened on "Not on yet" with nothing to tap in view: it is dialled again here, and the
    /// check that follows moves the page on.
    private func reconnectBuiltIn() {
        guard step == .loopback, model.setup.loopback == .builtIn, model.tunnel.available,
              !model.tunnel.connected, !model.tunnel.busy, !model.connectionInUse else { return }
        Task { try? await model.tunnel.connect(); model.loopback.check() }
    }

    private func advanceSoon() {
        let from = index
        Task { try? await Task.sleep(for: .milliseconds(600)); if index == from { advance() } }
    }

    private func advance() {
        guard index < steps.count - 1 else { return }
        withAnimation(.snappy) { index += 1 }
    }
}

extension SetupStep {
    /// The page's title (board 03: title case).
    var pageTitle: LocalizedStringKey {
        switch self {
        case .runner: "Install Poki Runner"
        case .developerMode: "Turn On Developer Mode"
        case .loopback: "Turn On Loopback"
        case .pairing: "Pair This iPhone"
        case .automation: "Allow UI Automation"
        case .background: "Keep Poki Running"
        }
    }

    var pageSummary: LocalizedStringKey {
        switch self {
        case .runner: "The helper app that taps and types for your agent. Poki starts it; you never open it."
        case .developerMode: SetupStep.inProcess ? "Allows Poki to use this iPhone’s developer services." : "Allows this iPhone to run Poki Runner."
        case .loopback: "Allows Poki to reach this iPhone’s developer services through your proxy app."
        case .pairing: "Gives Poki its own key to this iPhone. The key stays on this device."
        case .automation: SetupStep.inProcess ? "Allows Poki to control other apps." : "Allows Poki Runner to control other apps."
        case .background: "Keeps Poki connected in the background and shows its activity on the Lock Screen."
        }
    }
}

/// Opens Settings with the step in the Live Activity.
@MainActor func openSettings(_ model: AppModel, for step: SetupStep?) {
    if let step { model.guide(step) }
    // openSettingsURLString opens Poki's permissions, not the system settings named by these
    // steps. Open the Settings root instead; private pane URLs do not reliably reach their pane.
    // Location and Live Activities still belong on Poki's own permissions page.
    let destination: String
    switch step {
    case .runner?, .developerMode?, .pairing?, .automation?: destination = "App-prefs:"
    default: destination = UIApplication.openSettingsURLString
    }
    if let url = URL(string: destination) { UIApplication.shared.open(url) }
}

private struct InstructionsCard: View {
    var lines: [String]
    var body: some View {
        NumberedLines(lines: lines).padding(16).glassCard()
            .padding(.horizontal, 20).padding(.top, 24)
    }
}

private struct SetupFootnote: View {
    var text: LocalizedStringKey
    var body: some View {
        Text(text).site(13, line: 18).foregroundStyle(Site.c4).fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 36).padding(.top, 10)
    }
}

/// Open Settings and the switch for a step the phone can't check.
private struct ConfirmCard: View {
    @Environment(AppModel.self) private var model
    var step: SetupStep
    var title: LocalizedStringKey
    @Binding var isOn: Bool
    var body: some View {
        VStack(spacing: 0) {
            OpenSettingsRow(step: step)
            Toggle(isOn: $isOn) { Text(title).site(17, line: 22).frame(maxWidth: .infinity, alignment: .leading) }
                .toggleStyle(SiteToggleStyle())
                .padding(.vertical, 10).padding(.horizontal, 16)
        }
        .glassCard()
        .padding(.horizontal, 20).padding(.top, 20)
    }
}

private struct OpenSettingsRow: View {
    @Environment(AppModel.self) private var model
    var step: SetupStep
    var divider = true
    var body: some View {
        Button { openSettings(model, for: step) } label: {
            HStack(spacing: 10) {
                Image(systemName: "gear").font(.system(size: 17)).frame(width: 18)
                Text("Open Settings").site(17, line: 22).frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 13).padding(.horizontal, 16).contentShape(.rect)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { if divider { Site.edge.frame(height: 1) } }
    }
}

/// A row of plain text actions inside a glass card: "Import Pairing File ›", "Cancel Pairing".
private struct GlassActionRow: View {
    var title: LocalizedStringKey
    var color: Color = Site.text
    var chevron = false
    var divider = true
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack {
                Text(title).site(17, line: 22).foregroundStyle(color)
                Spacer()
                if chevron { Text(verbatim: "›").site(17, line: 22).foregroundStyle(Site.c4) }
            }
            .padding(.vertical, 13).padding(.horizontal, 16).contentShape(.rect)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { if divider { Site.edge.frame(height: 1) } }
    }
}

private struct SectionCaption: View {
    var text: LocalizedStringKey
    var body: some View {
        Text(text).site(13, line: 16).foregroundStyle(Site.c4)
            .padding(.leading, 36).padding(.trailing, 20).padding(.top, 24).padding(.bottom, 8)
    }
}

/// An icon and a sentence on the blue: a problem, a state.
private struct NoteLine: View {
    var symbol: String
    var color: Color = Site.text
    var text: String
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(color)
            Text(text).site(15, line: 20).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: 3, loopback

/// The loopback, checked live, and the proxy apps that can provide it. Sections of the step's Form.
private struct LoopbackPage: View {
    @Environment(AppModel.self) private var model
    @State private var copied: String?

    var body: some View {
        let monitor = model.loopback
        Section {
            LabeledContent {
                if monitor.state == .checking { ProgressView() }
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(headline(monitor))
                        Text(monitor.isWorking || monitor.state == .noAnswer ? LocalizedStringKey(monitor.detail) : "Checking 10.7.0.1 every few seconds…")
                            .font(.footnote).foregroundStyle(Color(.secondaryLabel))
                    }
                } icon: {
                    Image(systemName: monitor.isWorking ? "checkmark.circle.fill" : monitor.state == .noAnswer ? "exclamationmark.triangle.fill" : "circle.dashed")
                        .foregroundStyle(monitor.isWorking ? Color.green : monitor.state == .noAnswer ? Color.orange : Color.secondary)
                }
            }
        } header: {
            Text("Status")
        } footer: {
            if model.servicesSilent, monitor.isWorking {
                Text("10.7.0.1 takes the connection, but the phone's remote pairing service does not answer through it, so this page can show Working while Poki cannot connect. Reconnect your proxy app or LocalDevVPN, then pair again in Setup › Pairing.")
            }
        }

        // The external app is the way (ESP-168): every app's steps can be read at any time.
        Section {
            ForEach(ProxyApps.all) { app in
                NavigationLink { ProxyAppPage(app: app) } label: { proxyLabel(app.name, id: app.id, installed: app.isInstalled) }
            }
            NavigationLink { LocalDevVPNPage() } label: { proxyLabel("LocalDevVPN", id: "localdevvpn", installed: false, sub: "Free on the App Store") }
        } header: {
            Text("Use Your Proxy App")
        } footer: {
            if let chosen = model.setup.proxyApp, !monitor.isWorking, model.setup.loopback == .proxy {
                let name = ProxyApps.all.first { $0.id == chosen }?.name ?? "LocalDevVPN"
                Text("\(name) is chosen, but nothing answers at 10.7.0.1 right now. Open \(name), make sure it is connected with the loopback on, then come back; this page updates by itself.")
            }
        }
        .disabled(externalLocked)

        if model.tunnel.available {
            Section {
                switch model.tunnel.state {
                case .connecting:
                    LabeledContent("Built-in Connection") { ProgressView() }
                    Button("Cancel Connection", role: .destructive) { model.tunnel.disconnect() }.disabled(connectionLocked)
                case .connected:
                    LabeledContent("Built-in Connection", value: String(localized: "Connected"))
                    Button("Disconnect Local Connection") { model.tunnel.disconnect() }.disabled(connectionLocked)
                case .disconnecting:
                    LabeledContent("Built-in Connection") { ProgressView() }
                case .failed(let message):
                    Label(Bundle.main.localizedString(forKey: message, value: message, table: nil), systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    enableButton
                case .off, .unavailable:
                    enableButton
                }
                if model.setup.loopback == .builtIn {
                    Button("Use the Current VPN") { model.chooseConnection(.proxy) }.disabled(connectionLocked)
                }
            } header: {
                Text("Other Ways")
            } footer: {
                Text(model.connectionInUse ? "Stop Poki and finish pairing before changing the local connection." : "No extra app needed. Poki connects only to this iPhone; your normal traffic and DNS stay on their usual routes. iOS shows it as a VPN, so it may disconnect another VPN app.")
            }
        }
    }

    private func proxyLabel(_ name: String, id: String, installed: Bool, sub: LocalizedStringKey? = nil) -> some View {
        let chosen = model.setup.proxyApp == id
        let working = chosen && model.loopback.isWorking
        return LabeledContent {
            if working { Text("Working").foregroundStyle(.green) }
            else if chosen { Text("Not Answering").foregroundStyle(.orange) }
            else if installed { Text("Installed") }
        } label: {
            // The app's own icon, the size and corners of Settings' app rows.
            HStack(spacing: 12) {
                Image("Proxy-\(id)")
                    .resizable()
                    .frame(width: 29, height: 29)
                    .clipShape(.rect(cornerRadius: 6.5, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 6.5, style: .continuous).strokeBorder(Color(.separator), lineWidth: 0.5))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: name)
                    if let sub { Text(sub).font(.footnote).foregroundStyle(Color(.secondaryLabel)) }
                }
            }
        }
    }

    private var connectionLocked: Bool { model.connectionInUse || model.tunnel.busy }
    private var externalLocked: Bool { model.setup.loopback == .builtIn && connectionLocked }

    private var enableButton: some View {
        Button("Enable Local Connection") {
            model.chooseConnection(.builtIn)
            Task { try? await model.tunnel.connect(); model.loopback.check() }
        }
        .disabled(model.tunnel.busy || (model.connectionInUse && model.setup.loopback != .builtIn))
    }

    private func headline(_ monitor: LoopbackMonitor) -> LocalizedStringKey {
        switch monitor.state {
        case .working: "Loopback Is On"
        case .noAnswer: "Tunnel On, No Answer"
        default: "Not On Yet"
        }
    }
}

/// One proxy app's steps and its install action.
private struct ProxyAppPage: View {
    @Environment(AppModel.self) private var model
    var app: ProxyApp
    @State private var copied = false

    var body: some View {
        Form {
            Section {
                ForEach(Array(app.steps.enumerated()), id: \.offset) { i, line in
                    Label { Text(LocalizedStringKey(line)) } icon: { Image(systemName: "\(i + 1).circle") }
                }
            } header: {
                Text("How To")
            } footer: {
                if !app.documented {
                    Text("As reported by users of \(app.name); not checked against its documentation. The status on the Loopback page tells whether it works.")
                } else if !app.minimumVersion.isEmpty {
                    Text("\(app.name) \(app.minimumVersion) or later.")
                }
            }
            Section {
                switch app.install {
                case .url(let url):
                    Button(app.id == "surge" ? "Install Poki Module" : "Install Poki Plugin") { choose(); UIApplication.shared.open(url) }
                case .toggle:
                    Button("Open \(app.name)") { choose(); openApp() }
                case .snippet(let line):
                    Text(verbatim: line).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                    Button(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") {
                        choose(); UIPasteboard.general.string = line; copied = true
                    }
                    Button("Open \(app.name)") { openApp() }
                }
            }
            Section { LoopbackStatusRow() }
        }
        .navigationTitle(Text(verbatim: app.name))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func openApp() { if let url = URL(string: "\(app.scheme)://") { UIApplication.shared.open(url) } }

    private func choose() {
        model.chooseConnection(.proxy)
        model.setup.proxyApp = app.id
        model.guide(.loopback)
    }
}

private struct LocalDevVPNPage: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Form {
            Section("How To") {
                Label("No proxy app? Install LocalDevVPN, a free loopback app built for this.", systemImage: "1.circle")
                Label("Open it and tap Connect, then return to Poki. It may disconnect another VPN app.", systemImage: "2.circle")
            }
            Section {
                Button("Get LocalDevVPN on the App Store") {
                    model.chooseConnection(.proxy); model.setup.proxyApp = "localdevvpn"; model.guide(.loopback)
                    UIApplication.shared.open(URL(string: "https://apps.apple.com/app/id6755608044")!)
                }
            }
            Section { LoopbackStatusRow() }
        }
        .navigationTitle(Text(verbatim: "LocalDevVPN"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The live loopback check, one row.
private struct LoopbackStatusRow: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let working = model.loopback.isWorking
        LabeledContent("Loopback") {
            Text(working ? "Working" : model.loopback.state == .noAnswer ? "No Answer" : "Checking…")
                .foregroundStyle(working ? Color.green : Color.secondary)
        }
        .onAppear { model.loopback.resume() }
    }
}

// MARK: 4, pairing

private struct PairingPage: View {
    @Environment(AppModel.self) private var model
    @State private var importing = false
    @State private var importError: String?
    @State private var scanning = false

    struct MainAction {
        var title: LocalizedStringKey
        var run: @MainActor (AppModel) -> Void
    }

    /// The pairing page's own main button.
    @MainActor static func mainAction(_ model: AppModel) -> MainAction? {
        switch model.pairing {
        case .pin?: return MainAction(title: "Open Settings") { openSettings($0, for: .pairing) }
        case .advertising?: return nil
        case .failed?: return MainAction(title: "Try Again") { pair($0) }
        default:
            guard SetupStep.onDevicePairing else { return nil }
            if model.pairingTrouble != nil { return MainAction(title: "Pair Again") { pair($0) } }
            if model.pairingPath == nil { return MainAction(title: "Start Pairing") { pair($0) } }
            return nil
        }
    }

    @MainActor static func pair(_ model: AppModel) {
        model.startPairing()
        openSettings(model, for: .pairing)
    }

    var body: some View {
        switch model.pairing {
        case .pin(let pin)?:
            Section {
                Text(verbatim: pin.count == 6 ? "\(pin.prefix(3)) \(pin.suffix(3))" : pin)
                    .font(.system(.largeTitle, design: .rounded).weight(.bold)).monospacedDigit()
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .accessibilityLabel(Text(verbatim: pin.map(String.init).joined(separator: " ")))
            } header: {
                Text("Pairing Code")
            } footer: {
                Text("Enter this code in Settings. It also appears on the Lock Screen.")
            }
            Section { Button("Cancel Pairing", role: .destructive) { model.cancelPairing() } }
        case .advertising?:
            Section {
                Label("Waiting for Settings. Tap Pair with Poki there.", systemImage: "dot.radiowaves.left.and.right")
                    .symbolEffect(.pulse, options: .repeating)
                Label("Open **Settings › Privacy & Security › Developer Mode**.", systemImage: "1.circle")
                Label("Tap **Pair with Poki** and enter the code shown here and on the Lock Screen.", systemImage: "2.circle")
            }
            Section {
                Button("Open Settings", systemImage: "gear") { openSettings(model, for: .pairing) }
                Button("Cancel Pairing", role: .destructive) { model.cancelPairing() }
            }
        case .failed(let why)?:
            Section { Label(why, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
        default:
            if let trouble = model.pairingTrouble {
                Section {
                    Label(String(localized: "The phone no longer accepts this pairing: \(trouble)"), systemImage: "exclamationmark.triangle")
                } footer: {
                    Text(SetupStep.onDevicePairing ? "This happens after a restore, a reset of Location & Privacy, or when the phone forgot Poki. Pair again; the old key is replaced." : "This happens after a restore, a reset of Location & Privacy, or when the phone forgot Poki. Pair again from Poki Setup on your computer and send the new file here; the old key is replaced.")
                }
            } else if model.pairingPath != nil {
                Section {
                    Label(model.pairingVerifiedAt.map { String(localized: "Paired. The phone accepted it at \($0.formatted(date: .omitted, time: .shortened)).") }
                            ?? String(localized: "Paired. Checked the next time the runner starts."), systemImage: "checkmark.seal.fill")
                }
            } else if SetupStep.onDevicePairing {
                Section("How To") {
                    Label("Connect to Wi‑Fi and tap **Start Pairing**. Allow local network access when prompted.", systemImage: "1.circle")
                    Label("Poki opens the main Settings page. Go to **Privacy & Security › Developer Mode** and tap **Pair with Poki**.", systemImage: "2.circle")
                    Label("Enter the code shown here and on the Lock Screen.", systemImage: "3.circle")
                }
            } else {
                Section {
                    Label("Pairing on the phone itself needs iOS 27; this iPhone runs iOS \(UIDevice.current.systemVersion). Pair it from a computer instead.", systemImage: "1.circle")
                    Label("Open **Poki Setup** on your Mac or PC, connect this iPhone by cable, and tap **Pair**. Tap **Trust** on the iPhone when asked.", systemImage: "2.circle")
                    Label("Send the pairing file here: tap **Scan Pairing Code** below (or scan Poki Setup's code with the Camera), AirDrop the file to this iPhone and open it with Poki, or tap **Import Pairing File** below.", systemImage: "3.circle")
                } header: {
                    Text("How To")
                } footer: {
                    Text("No Poki Setup yet? Any lockdown pairing file works: pymobiledevice3, jitterbugpair or StikPair make one.")
                }
            }
        }
        if let action = Self.mainAction(model) {
            Section { Button(action.title) { action.run(model) }.bold() }
        }
        if let note = model.pairingNote {
            Section { Text(note).font(.footnote) }
        }
        Section {
            diskImage
        } header: {
            Text("Developer Disk Image")
        }
        Section {
            if PairingScanner.available {
                Button("Scan Pairing Code", systemImage: "qrcode.viewfinder") { scanning = true }
            }
            Button("Import Pairing File", systemImage: "doc.badge.plus") { importing = true }
            if SetupStep.onDevicePairing && model.pairing == nil && model.pairingTrouble == nil && model.pairingPath != nil {
                Button("Pair Again", systemImage: "arrow.triangle.2.circlepath") { Self.pair(model) }
            }
        } header: {
            Text("Other Ways")
        } footer: {
            if let importError { Text(importError).foregroundStyle(.red) }
        }
        .sheet(isPresented: $scanning) { PairingScannerSheet() }
        // Poki Setup on a computer may be writing the file into Poki right now.
        .task { while !Task.isCancelled { model.lookForHandedPairing(); try? await Task.sleep(for: .seconds(3)) } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.propertyList, .xml, .data]) { result in
            do { try model.importPairingFile(from: result.get()); importError = nil }
            catch { importError = String(localized: "Invalid Pairing File: \(error.localizedDescription)") }
        }
    }

    @ViewBuilder private var diskImage: some View {
        switch model.diskImage.state {
        case .ready:
            LabeledContent("Status", value: String(localized: "Ready"))
        case .downloading(let step):
            LabeledContent("Downloading") { HStack { Text(verbatim: "\(step)"); ProgressView() } }
        case .missing:
            Button("Download Developer Disk Image") { Task { await model.diskImage.download() } }
        case .failed(let why):
            Label(why, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
            Button("Download Again") { Task { await model.diskImage.download() } }
        }
    }
}

// MARK: 6, background

private struct BackgroundPage: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var refresh = UIApplication.shared.backgroundRefreshStatus

    var body: some View {
        Section {
            LabeledContent {
                if model.background.allowed { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
            } label: {
                Label("Location", systemImage: "location")
            }
            if model.background.denied {
                Button("Open Settings", systemImage: "gear") { openSettings(model, for: .background) }
            } else if !model.background.allowed {
                Button("Allow Location Access") { model.background.requestPermission() }
            } else if !model.background.always {
                Button("Change to Always Allow") { model.background.requestPermission() }
                Button("Open Settings", systemImage: "gear") { openSettings(model, for: .background) }
            }
        } footer: {
            Text(model.background.always ? "Poki stays active in the background without the location indicator, and never records your location."
                 : model.background.allowed ? "Poki keeps itself running with silent audio. Always Allow makes that sturdier, and iOS shows no location indicator for it. Poki never records your location."
                 : model.background.denied ? "Location Services is off for Poki. It keeps itself running with silent audio, which iOS may stop during calls or other audio."
                 : "iOS needs a background mode to keep apps running. Poki uses lowest-accuracy location with Always Allow, which shows no location indicator, and never records your location.")
        }
        Section {
            LabeledContent {
                if refresh == .available { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                else { Text("Off").foregroundStyle(.orange) }
            } label: {
                Label("Background App Refresh", systemImage: "arrow.clockwise")
            }
            Button("Open Settings", systemImage: "gear") { openSettings(model, for: .background) }
        } footer: {
            Text(refresh == .available ? "Keep Background App Refresh on for Poki. With it off, iOS stops Poki soon after it leaves the screen."
                 : refresh == .restricted ? "Background App Refresh is restricted on this iPhone (Low Power Mode, Screen Time or a profile turns it off), so iOS may stop Poki in the background."
                 : "Turn on **Background App Refresh** on Poki’s page in Settings, and under Settings › General › Background App Refresh. With it off, iOS stops Poki soon after it leaves the screen.")
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { refresh = UIApplication.shared.backgroundRefreshStatus } }
        Section {
            LabeledContent {
                if model.activitiesEnabled { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                else { Text("Off").foregroundStyle(.orange) }
            } label: {
                Label("Live Activities", systemImage: "platter.filled.bottom.iphone")
            }
            if !model.activitiesEnabled {
                Button("Open Settings", systemImage: "gear") { openSettings(model, for: .background) }
            }
        } footer: {
            Text(model.activitiesEnabled ? "Poki shows steps, pairing codes and approvals on the Lock Screen." : "Turn them on to see the agent’s steps and approve sensitive actions.")
        }
        Section { EmptyView() } footer: {
            Text(SetupStep.inProcess ? "The first time Poki turns on after a restart, iOS asks for your passcode to allow automation. Enter it once; Poki never sees it." : "The first time Poki Runner starts after a restart, iOS asks for your passcode to allow automation. Enter it once; Poki never sees it.")
        }
    }
}

// MARK: Checklist

/// Setup as one checklist: everything Poki needs to run on this iPhone, each with a tick or what is
/// wrong, and a tap opens its fix. It is on the Chats page (the steps still open) and in the Poki tab.
struct SetupChecklist: View {
    @Environment(AppModel.self) private var model
    @State private var guiding = false

    var body: some View {
        List {
            Section {
                ForEach(SetupStep.shown) { step in
                    NavigationLink(value: step) { SetupStepRow(step: step) }
                }
                // Poki's own keyboard, which it types through on this path. It does not hold Poki
                // back: without it, plain text is still typed with key presses.
                if AutomationPath.current == .nativeServices {
                    NavigationLink { PokiKeyboardPage() } label: { PokiKeyboardSetupRow() }
                }
            } footer: {
                Text(model.setupComplete ? "Everything Poki needs is in place." : "Poki needs every item ticked before an agent or the chat can use this iPhone. Items tick themselves when the phone can check them.")
            }
            SigningSection()
            Section {
                Button("Setup Guide", systemImage: "list.number") { guiding = true }
            } footer: {
                Text("Walks through every item in order. You can close it at any time and pick up from this list.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Setup")
        .onAppear { model.loopback.resume() }
        .sheet(isPresented: $guiding) { SetupGuide(start: SetupStep.shown.first { !model.isDone($0) }) }
    }
}

/// One item: its symbol, its name, and Done or what is wrong.
struct SetupStepRow: View {
    @Environment(AppModel.self) private var model
    var step: SetupStep

    var body: some View {
        let done = model.isDone(step)
        LabeledContent {
            if done {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityLabel(Text("Done"))
            } else {
                Text(problem).foregroundStyle(.orange)
            }
        } label: {
            Label(step.pageTitle, systemImage: step.symbol)
        }
    }

    private var problem: String {
        switch step {
        case .loopback:
            if model.loopback.state == .noAnswer { return String(localized: "No Answer") }
            return model.setup.loopback == .none ? String(localized: "Needed") : String(localized: "Off")
        case .pairing:
            if model.pairingTrouble != nil { return String(localized: "Pair Again") }
            if model.pairingPath != nil, !model.diskImage.isReady { return String(localized: "Downloading") }
            return String(localized: "Needed")
        default: return String(localized: "Needed")
        }
    }
}

/// One item's page: what it is for, how to do it, and its check or switch.
struct SetupStepPage: View {
    @Environment(AppModel.self) private var model
    var step: SetupStep

    var body: some View {
        switch step {
        case .runner, .developerMode, .automation: formPage
        default: cardPage
        }
    }

    /// The steps the phone can't check: a native form with the steps, Open Settings and the switch.
    private var formPage: some View {
        Form {
            Section {
                LabeledContent {
                    Text(model.isDone(step) ? "Done" : "Needed").foregroundStyle(model.isDone(step) ? Color.green : Color.orange)
                } label: {
                    Label(step.pageTitle, systemImage: step.symbol)
                }
            } footer: {
                Text(step.pageSummary)
            }
            Section("How To") {
                ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                    Label { Text(LocalizedStringKey(line)) } icon: { Image(systemName: "\(i + 1).circle") }
                }
            }
            Section {
                Button("Open Settings", systemImage: "gear") { openSettings(model, for: step) }
                Toggle(confirmTitle, isOn: confirmBinding)
            } footer: {
                Text("iOS doesn’t let Poki check this one, so turn the switch on once it’s done.")
            }
        }
        .navigationTitle(Text(step.pageTitle))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { model.loopback.resume() }
    }

    private var lines: [String] {
        switch step {
        case .runner: [
            "Install **Poki Runner** (poki-runner-unsigned.ipa) with the same tool and Apple ID you used for Poki.",
            "Open **Settings › General › VPN & Device Management**, tap your Apple ID, then tap **Trust**.",
            "Don’t open Poki Runner yourself. Poki starts it when an agent needs this iPhone.",
        ]
        case .developerMode: [
            SetupStep.inProcess ? "Open **Settings › Privacy & Security › Developer Mode**." : "Open **Settings › Privacy & Security › Developer Mode**. It appears once Poki Runner is installed.",
            "Turn on Developer Mode, then tap **Restart**.",
            "After restarting, unlock this iPhone and tap **Turn On**.",
        ]
        default: [
            "Open **Settings › Developer**. It appears once Developer Mode is on.",
            "Turn on **Enable UI Automation**.",
        ]
        }
    }

    private var confirmTitle: LocalizedStringKey {
        switch step {
        case .runner: "Poki Runner Is Installed and Trusted"
        case .developerMode: "Developer Mode Is On"
        default: "UI Automation Is On"
        }
    }

    private var confirmBinding: Binding<Bool> {
        switch step {
        case .runner: binding(\.runnerInstalled)
        case .developerMode: binding(\.developerMode)
        default: binding(\.uiAutomation)
        }
    }

    /// Loopback, pairing and background: the same native form, with their live sections.
    private var cardPage: some View {
        Form {
            Section {
                LabeledContent {
                    Text(model.isDone(step) ? "Done" : "Needed").foregroundStyle(model.isDone(step) ? Color.green : Color.orange)
                } label: {
                    Label(step.pageTitle, systemImage: step.symbol)
                }
            } footer: {
                Text(step.pageSummary)
            }
            content
        }
        .navigationTitle(Text(step.pageTitle))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            model.loopback.resume()
            if step == .loopback, model.setup.loopback == .builtIn, model.tunnel.available, !model.tunnel.connected, !model.tunnel.busy, !model.connectionInUse {
                Task { try? await model.tunnel.connect(); model.loopback.check() }
            }
        }
        .onDisappear { if step == .pairing { model.leftPairing() } }
    }

    private func binding(_ key: WritableKeyPath<SetupState, Bool>) -> Binding<Bool> {
        Binding(get: { model.setup[keyPath: key] }, set: { model.setup[keyPath: key] = $0 })
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .runner:
            InstructionsCard(lines: [
                "Install **Poki Runner** (poki-runner-unsigned.ipa) with the same tool and Apple ID you used for Poki.",
                "Open **Settings › General › VPN & Device Management**, tap your Apple ID, then tap **Trust**.",
                "Don’t open Poki Runner yourself. Poki starts it when an agent needs this iPhone.",
            ])
            ConfirmCard(step: .runner, title: "Poki Runner is installed and trusted", isOn: binding(\.runnerInstalled))
        case .developerMode:
            InstructionsCard(lines: [
                SetupStep.inProcess ? "Open **Settings › Privacy & Security › Developer Mode**." : "Open **Settings › Privacy & Security › Developer Mode**. It appears once Poki Runner is installed.",
                "Turn on Developer Mode, then tap **Restart**.",
                "After restarting, unlock this iPhone and tap **Turn On**.",
            ])
            ConfirmCard(step: .developerMode, title: "Developer Mode is on", isOn: binding(\.developerMode))
        case .loopback: LoopbackPage()
        case .pairing: PairingPage()
        case .automation:
            InstructionsCard(lines: [
                "Open **Settings › Developer**. It appears once Developer Mode is on.",
                "Turn on **Enable UI Automation**.",
            ])
            ConfirmCard(step: .automation, title: "UI Automation is on", isOn: binding(\.uiAutomation))
        case .background: BackgroundPage()
        }
    }
}

/// The setup guidance as a walk through every item, from the first one still open. Close leaves it at
/// any time; the checklist keeps what is done.
struct SetupGuide: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var index: Int

    /// The Poki keyboard is the guide's last page where Poki types through it. It is not one of the
    /// steps Poki waits for: without it, plain text is still typed with key presses.
    private static var keyboardPage: Bool { AutomationPath.current == .nativeServices }

    init(start: SetupStep?) {
        let steps = SetupStep.shown
        // With every step done, the guide opens on the keyboard while that is still to add.
        let fallback = Self.keyboardPage && !PokiKeyboardState().ready && start == nil ? steps.count : 0
        _index = State(initialValue: start.flatMap { steps.firstIndex(of: $0) } ?? fallback)
    }

    private var steps: [SetupStep] { SetupStep.shown }
    private var count: Int { steps.count + (Self.keyboardPage ? 1 : 0) }

    var body: some View {
        NavigationStack {
            Group {
                if index < steps.count {
                    SetupStepPage(step: steps[index]).id(steps[index].rawValue)
                } else {
                    PokiKeyboardPage().id("keyboard")
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("Back", systemImage: "chevron.left") { index -= 1 }.disabled(index == 0)
                    Spacer()
                    Text("\(index + 1) of \(count)").font(.footnote).foregroundStyle(Color(.secondaryLabel))
                    Spacer()
                    if index + 1 < count {
                        Button("Next", systemImage: "chevron.right") { index += 1 }
                    } else {
                        Button("Done") { dismiss() }.bold()
                    }
                }
            }
        }
    }
}
