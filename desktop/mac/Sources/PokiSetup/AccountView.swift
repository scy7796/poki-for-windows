import SwiftUI

struct AccountView: View {
    @EnvironmentObject var model: AppModel
    @State private var appleID = ""
    @State private var password = ""
    @State private var keep = true
    @State private var working = false
    @State private var error: String?
    @State private var code = ""
    @State private var confirmSignOut = false

    var body: some View {
        Form {
            if let a = model.account, a.signedIn {
                signedIn(a)
            } else {
                signInForm
            }
        }
        .pokiPage()
        .sheet(isPresented: $model.needsCode) { codeSheet }
    }

    @ViewBuilder private func signedIn(_ a: AccountState) -> some View {
        HeroSection {
            HStack(spacing: 14) {
                AccountBadge(name: a.name, appleID: a.appleId, signedIn: true, size: PageHeroMetrics.icon)
                VStack(alignment: .leading, spacing: 2) {
                    Text(a.name ?? "Apple Account").font(.title3.weight(.bold)).lineLimit(1)
                    Text(a.appleId ?? "").font(.callout).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
            }
            .frame(minHeight: PageHeroMetrics.height)
        }
        Section("Signing") {
            if model.teams.isEmpty {
                LabeledContent("Team") { ProgressView().controlSize(.small) }
            } else {
                Picker("Team", selection: Binding(get: { a.teamId ?? model.teams.first?.teamId ?? "" }, set: { id in
                    if let t = model.teams.first(where: { $0.teamId == id }) { Task { await model.chooseTeam(t) } }
                })) {
                    ForEach(model.teams) { t in Text(t.name).tag(t.teamId) }
                }
                if let t = model.teams.first(where: { $0.teamId == (a.teamId ?? model.teams.first?.teamId) }) {
                    LabeledContent("Kind") {
                        Text(t.isFree ? "Free Personal Team: apps last 7 days, Poki Setup renews them" : "Apple Developer Program: apps last a year")
                            .foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                    }
                }
            }
            StatusRow(title: "Automatic Renewal", value: a.passwordKept ? "On" : "Off: sign in again with “Keep me signed in”", tone: a.passwordKept ? .good : .warn)
        }
        Section {
            Button("Sign Out…", role: .destructive) { confirmSignOut = true }
                .confirmationDialog("Sign out of \(a.appleId ?? "this Apple Account")?", isPresented: $confirmSignOut) {
                    Button("Sign Out", role: .destructive) { Task { await model.signOut() } }
                } message: {
                    Text("Poki stays on your iPhones, but Poki Setup can't renew it until you sign in again.")
                }
        }
    }

    @ViewBuilder private var signInForm: some View {
        HeroSection {
            PageHero(symbol: "person.crop.circle", title: "Sign in with your Apple Account", subtitle: "Poki Setup uses it the way Xcode does: to sign Poki for your iPhone. A free Apple Account works. Your password goes to Apple only.")
        }
        Section {
            TextField("Email or Phone Number", text: $appleID, prompt: Text("name@example.com"))
                .textContentType(.username)
            SecureField("Password", text: $password, prompt: Text("Required"))
                .textContentType(.password)
                .onSubmit { Task { await signIn() } }
            Toggle("Keep me signed in to renew Poki automatically", isOn: $keep)
        } footer: {
            Text("With a free account, apps stop opening after 7 days. Poki Setup renews Poki before then while this Mac is on, using the password kept in your keychain.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        Section {
            HStack {
                if let error {
                    Text(error).foregroundStyle(.red).font(.callout).textSelection(.enabled)
                }
                Spacer()
                if working { ProgressView().controlSize(.small) }
                Button("Sign In") { Task { await signIn() } }
                    .pokiProminentButton()
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
                    .disabled(working || appleID.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)
            }
        }
    }

    private var codeSheet: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.shield").font(.system(size: 40)).foregroundStyle(Color.pokiBlue)
            Text("Two-Factor Authentication").font(.title2.weight(.semibold))
            Text(model.codeVia == "sms" ? "Enter the code Apple sent to your phone number." : "Enter the verification code shown on your other Apple devices.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            TextField("6-digit code", text: $code)
                .font(.system(size: 24, weight: .medium, design: .monospaced))
                .multilineTextAlignment(.center)
                .textFieldStyle(.roundedBorder)
                .frame(width: 200)
                .onSubmit { Task { await verify() } }
                .onChange(of: code) { _, new in
                    let digits = new.filter(\.isNumber)
                    if digits != new { code = digits }
                    if digits.count == 6 { Task { await verify() } }
                }
            if let error { Text(error).foregroundStyle(.red).font(.callout) }
            HStack {
                Button("Cancel") {
                    model.needsCode = false
                    code = ""
                }
                .keyboardShortcut(.cancelAction)
                Spacer()
                if working { ProgressView().controlSize(.small) }
                Button("Verify") { Task { await verify() } }
                    .pokiProminentButton()
                    .keyboardShortcut(.defaultAction)
                    .disabled(code.count != 6 || working)
            }
        }
        .padding(24)
        .frame(width: 380)
    }

    private func signIn() async {
        guard !working else { return }
        working = true
        error = nil
        defer { working = false }
        do {
            try await model.signIn(appleID: appleID.trimmingCharacters(in: .whitespaces), password: password, keep: keep)
            if !model.needsCode { password = "" }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func verify() async {
        guard !working, code.count == 6 else { return }
        working = true
        error = nil
        defer { working = false }
        do {
            try await model.finishSignIn(code: code)
            code = ""
            password = ""
        } catch {
            self.error = error.localizedDescription
            code = ""
        }
    }
}
