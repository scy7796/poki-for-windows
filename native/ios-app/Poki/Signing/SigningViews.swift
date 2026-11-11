import SwiftUI

/// The Apple Account, optional and out of the way (ESP-222): Poki Setup on a Mac signs Poki, and
/// signed in here Poki can also renew itself with no computer. Sections of the Apple Account page's Form.
struct AccountPage: View {
    @Environment(AppModel.self) private var model
    @State private var appleID = ""
    @State private var password = ""
    @State private var keepPassword = true
    @State private var code = ""

    private var signer: SelfSigner { model.signer }

    var body: some View {
        if signer.signedIn {
            Section {
                LabeledContent("Apple Account", value: signer.status?.apple_id ?? "")
                if let name = signer.status?.name, name != signer.status?.apple_id { LabeledContent("Name", value: name) }
                if signer.teams.count > 1 {
                    Picker("Team", selection: Binding(get: { signer.status?.team_id ?? "" }, set: { id in
                        if let team = signer.teams.first(where: { $0.team_id == id }) { Task { await signer.choose(team: team) } }
                    })) {
                        ForEach(signer.teams) { team in Text(team.is_free ? "\(team.name) (Free)" : team.name).tag(team.team_id) }
                    }
                } else if let team = signer.teams.first {
                    LabeledContent("Team", value: team.is_free ? "\(team.name) (Free, 7-day signing)" : team.name)
                }
            } footer: {
                Text(signer.status?.keeps_password == true
                     ? "Poki keeps the password in this iPhone’s Keychain to sign itself again every week."
                     : "Poki signs in again when its signing is due, and asks you for the password then.")
            }
            .task { if signer.teams.isEmpty { await signer.loadTeams() } }
            Section { Button("Sign Out", role: .destructive) { Task { await signer.signOut() } } }
        } else if signer.needsCode {
            Section {
                TextField("Verification Code", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                Button("Verify") { Task { await signer.finishSignIn(code: code); code = "" } }
                    .disabled(code.count != 6 || signer.working != nil)
            } footer: {
                Text("Apple sent a six-digit code to your trusted devices or phone number.")
            }
        } else {
            Section {
                TextField("Apple ID", text: $appleID)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                    .textContentType(.password)
                Toggle("Keep Me Signed In", isOn: $keepPassword)
            } footer: {
                Text("A free Apple Account works: Poki signs itself for 7 days at a time and gets ready to sign again before then. Your Apple ID and password go only to Apple. The anisette server Poki asks for its device headers never sees them.")
            }
            Section {
                Button("Sign In") { Task { await signer.signIn(appleID: appleID, password: password, keepPassword: keepPassword); password = "" } }
                    .disabled(appleID.isEmpty || password.isEmpty || signer.working != nil)
            }
        }
        SignerActivityRows(signer: signer)
    }
}

/// What the signer is doing, or why it stopped.
struct SignerActivityRows: View {
    let signer: SelfSigner
    var body: some View {
        if let working = signer.working {
            Section {
                if let f = signer.fraction { ProgressView(value: f) { Text(working) } } else { LabeledContent { ProgressView() } label: { Text(working) } }
            }
        }
        if let error = signer.lastError {
            Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
        }
    }
}

/// The Setup page's signing section: when Poki stops opening, the build that is ready, and Install.
struct SigningSection: View {
    @Environment(AppModel.self) private var model
    private var signer: SelfSigner { model.signer }

    var body: some View {
        Section {
            LabeledContent {
                Text(verbatim: "\(signer.installedVersion) (\(signer.installedBuild))")
            } label: {
                Label("Poki Version", systemImage: "info.circle")
            }
            LabeledContent {
                if let expiry = signer.expiry {
                    // One line: the date, and how long is left in the warning colour when it is close.
                    (Text(expiry, format: .dateTime.month(.abbreviated).day().year()) + Text(verbatim: " · ") + Text(expiry, style: .relative).foregroundStyle(countdownColor))
                        .lineLimit(1).minimumScaleFactor(0.8)
                } else {
                    Text("No Profile").foregroundStyle(Color(.secondaryLabel))
                }
            } label: {
                Label("Signed Until", systemImage: "signature")
            }
            // A newer build that isn't downloaded yet shows even when a refresh (or an older update) is
            // ready, so it is never hidden behind it.
            if signer.updateNotReady, let latest = signer.latest {
                LabeledContent { Text(verbatim: "\(latest.version) (\(latest.build))") } label: { Label("Update Available", systemImage: "sparkles") }
            } else if let next = signer.next {
                LabeledContent {
                    Text(next.kind == "update" ? "\(next.version) (\(next.build))" : "Until \(next.expires.formatted(.dateTime.month(.abbreviated).day().year()))").lineLimit(1)
                } label: {
                    Label(next.kind == "update" ? "Update Ready" : "Refresh Ready", systemImage: "checkmark.seal")
                }
            }
            NavigationLink { SigningOptionsPage() } label: {
                Label("Signing Options", systemImage: "slider.horizontal.3")
            }
            // The actions last, under what they act on. A newer build not yet downloaded comes first:
            // one tap downloads and installs it (or, without an Apple Account, opens the sign-in).
            if signer.updateNotReady {
                if signer.signedIn {
                    action("Download and Install Update", systemImage: "arrow.down.circle", id: "download") { await signer.downloadAndInstallUpdate() }
                } else {
                    NavigationLink {
                        Form { AccountPage() }
                            .navigationTitle("Apple Account")
                            .navigationBarTitleDisplayMode(.inline)
                    } label: {
                        Label("Sign In to Download the Update", systemImage: "person.crop.circle.badge.plus")
                    }
                }
            } else if let next = signer.next {
                // Idle is partly time (a minute since the last agent step), which nothing observes, so
                // the row looks again every few seconds instead of staying as it was first drawn.
                TimelineView(.periodic(from: .now, by: 5)) { _ in
                    action(next.kind == "update" ? "Install Update" : "Install Refresh", systemImage: "arrow.down.app", id: "install") { await signer.install() }
                }
            }
            if signer.signedIn {
                action("Prepare Refresh Now", systemImage: "arrow.clockwise", id: "refresh") { await signer.prepare(kind: "refresh") }
            }
        } header: {
            Text("Updates")
        } footer: {
            Text(footer)
        }
        SignerActivityRows(signer: signer)
    }

    /// The action last tapped, which shows a spinner while it runs.
    @State private var pressed: String?

    /// One action row: its symbol and title in the same tint, and the system's
    /// spinner at the trailing edge from the tap until the work ends.
    private func action(_ title: LocalizedStringKey, systemImage: String, id: String, _ work: @escaping () async -> Void) -> some View {
        Button {
            pressed = id
            Task { await work(); if pressed == id { pressed = nil } }
        } label: {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                if pressed == id, signer.working != nil { ProgressView() }
            }
        }
        .disabled(signer.working != nil)
    }

    private var countdownColor: Color {
        guard let days = signer.daysLeft else { return .secondary }
        return days <= 1 ? .red : days <= SelfSigner.refreshWithDaysLeft ? .orange : .secondary
    }

    private var footer: String {
        if let blocker = signer.updateBlocker { return blocker }
        if !signer.signedIn { return String(localized: "Poki Setup on your Mac renews Poki when this iPhone is connected.") }
        if signer.next != nil {
            return model.signingIdle
                ? String(localized: "Installing closes Poki for a moment. Your chats and setup stay.")
                : (model.signingBusyReason ?? "") + " " + String(localized: "Install is available when Poki isn’t running a task.")
        }
        return String(localized: "Poki gets the next build ready by itself, \(Int(SelfSigner.refreshWithDaysLeft)) days before it expires or when your channel has an update. It installs only when you tap Install.")
    }
}

/// Home's warning that the installed Poki stops opening soon (ESP-222). Renewing happens on the Mac:
/// it installs a build with a new profile, so a renewed Poki has a later expiry and no warning.
struct ExpiryWarning {
    let expiry: Date

    init?(expiry: Date?, now: Date = .now) {
        guard let expiry, expiry.timeIntervalSince(now) <= SelfSigner.warnWithDaysLeft * 86_400 else { return nil }
        self.expiry = expiry
    }

    var message: String {
        let when = expiry.formatted(date: .abbreviated, time: .shortened)
        return String(localized: "Poki stops opening after \(when). Connect this iPhone to your Mac and ask your agent to renew it.")
    }
}

struct ExpiryWarningSection: View {
    let warning: ExpiryWarning

    var body: some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Poki’s signing ends soon").font(Prominent.font(.headline, .semibold))
                    Text(warning.message).font(.subheadline).foregroundStyle(Color(.secondaryLabel))
                }
            } icon: {
                Image(systemName: "clock.badge.exclamationmark.fill").foregroundStyle(.orange)
            }
        }
    }
}

/// The release channel, the anisette server, and the optional Apple Account.
struct SigningOptionsPage: View {
    @Environment(AppModel.self) private var model
    @State private var anisette = ""
    /// The channel's newest build has been looked up (found or not) since the page opened.
    @State private var checked = false
    private var signer: SelfSigner { model.signer }

    /// Shown most stable first, as the person reads them.
    private var channels: [SelfSigner.Channel] {
        let order = ["stable", "beta", "alpha", "pre-alpha"]
        return (signer.status?.channels ?? []).sorted { (order.firstIndex(of: $0.id) ?? 9) < (order.firstIndex(of: $1.id) ?? 9) }
    }

    var body: some View {
        Form {
            Section {
                Picker("Release Channel", selection: Binding(get: { signer.status?.channel ?? "stable" }, set: { id in Task { await signer.setChannel(id) } })) {
                    ForEach(channels) { Text($0.title).tag($0.id) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text("Release Channel")
            } footer: {
                Text("Poki downloads and signs updates from this channel ahead of time, the same way Poki Setup does. Stable gets full releases only; Beta, Alpha and Pre-alpha get earlier builds.")
            }
            Section {
                LabeledContent("Installed") { Text(verbatim: "\(signer.installedVersion) (\(signer.installedBuild))") }
                LabeledContent("Newest on This Channel") {
                    if let latest = signer.latest {
                        Text(verbatim: "\(latest.version) (\(latest.build))")
                    } else {
                        (checked ? Text("Not Found") : Text("Checking…")).foregroundStyle(Color(.secondaryLabel))
                    }
                }
                if let latest = signer.latest {
                    LabeledContent("Status") { signer.isNewer(latest) ? Text("Update Available") : Text("Up to Date") }
                }
            } header: {
                Text("Version")
            } footer: {
                Text("Poki looks on GitHub for the newest build on the chosen channel.")
            }
            .task(id: signer.status?.channel) {
                checked = false
                await signer.checkLatest()
                checked = true
            }
            Section {
                TextField("https://new.ani.sidestore.io", text: $anisette)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await signer.setAnisette(anisette) } }
                Button("Use Default Server") { anisette = ""; Task { await signer.setAnisette("") } }
            } header: {
                Text("Anisette Server")
            } footer: {
                Text("Apple’s sign-in needs device headers that only Apple hardware makes. Poki gets them from this anisette server. It never sees your Apple ID or password.")
            }
            Section {
                NavigationLink {
                    Form { AccountPage() }
                        .navigationTitle("Apple Account")
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    LabeledContent {
                        if signer.signedIn { Text(verbatim: signer.status?.apple_id ?? "") }
                        else { Text("Optional").foregroundStyle(Color(.secondaryLabel)) }
                    } label: {
                        Label("Apple Account", systemImage: "person.crop.circle")
                    }
                }
            } footer: {
                Text("Optional. To renew Poki without a Mac, sign in to your Apple Account here.")
            }
            SignerActivityRows(signer: signer)
        }
        .navigationTitle("Signing")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { anisette = signer.status?.anisette ?? "" }
    }
}
