import SwiftUI

struct ContentView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        NavigationSplitView {
            List(selection: Binding(get: { model.page }, set: { if let p = $0 { model.page = p } })) {
                Section {
                    ForEach([Page.setup, .phones, .account]) { p in
                        Label(p.title, systemImage: p.symbol).tag(p)
                    }
                }
                Section("Advanced") {
                    ForEach([Page.relay, .debug]) { p in
                        Label(p.title, systemImage: p.symbol).tag(p)
                    }
                }
            }
            .listStyle(.sidebar)
            .noTopEdgeFade()
            .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 260)
            .safeAreaInset(edge: .bottom) { SidebarFooter() }
        } detail: {
            Group {
                switch model.page {
                case .setup: SetupView()
                case .phones: PhonesView()
                case .account: AccountView()
                case .relay: RelayView()
                case .debug: DiagnosticsView()
                }
            }
            .navigationTitle(model.page.title)
        }
        .overlay(alignment: .bottom) {
            if let text = model.banner {
                Banner(text: text) { model.banner = nil }
                    .padding(16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: model.banner)
        .alert("Poki Setup \(displayVersion(model.updatePrompt ?? "")) is available", isPresented: Binding(get: { model.updatePrompt != nil }, set: { if !$0 { model.updatePrompt = nil } })) {
            Button("Restart to Update") {
                Task {
                    do { try await model.installUpdate() } catch { model.banner = error.localizedDescription }
                }
            }
            .keyboardShortcut(.defaultAction)
            Button("Later", role: .cancel) {}
        } message: {
            Text("Poki Setup downloads the update, checks its signature and restarts.")
        }
    }
}

private struct SidebarFooter: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        HStack(spacing: 10) {
            AccountBadge(name: model.account?.name, appleID: model.account?.appleId, signedIn: model.account?.signedIn == true)
            VStack(alignment: .leading, spacing: 1) {
                Text(model.account?.signedIn == true ? (model.account?.name ?? "Signed In") : "Not Signed In")
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                Text(model.account?.signedIn == true ? (model.account?.appleId ?? "") : "Sign in to set up Poki")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .onTapGesture { model.page = .account }
    }
}

/// The Apple Account's picture: this Mac's account photo when the Mac is signed in to the same
/// Apple Account (the photo the Apple Account uses), otherwise initials on flat Poki blue.
struct AccountBadge: View {
    var name: String?
    var appleID: String? = nil
    var signedIn: Bool
    var size: CGFloat = 28

    var body: some View {
        ZStack {
            if signedIn, let photo = AccountPhoto.shared.photo(for: appleID) {
                Image(nsImage: photo).resizable().scaledToFill()
            } else {
                Circle().fill(signedIn ? Color.pokiBlue : Color.secondary.opacity(0.25))
                if signedIn, let initials = initials {
                    Text(initials).font(.system(size: size * 0.42, weight: .semibold)).foregroundStyle(.white)
                } else {
                    Image(systemName: "person.fill").font(.system(size: size * 0.46)).foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var initials: String? {
        guard let name, !name.contains("@") else { return nil }
        let parts = name.split(separator: " ").prefix(2).compactMap(\.first)
        return parts.isEmpty ? nil : String(parts)
    }
}

private struct Banner: View {
    var text: String
    var close: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button("Copy") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
            .buttonStyle(.borderless)
            Button(action: close) { Image(systemName: "xmark") }
                .buttonStyle(.borderless)
                .accessibilityLabel("Dismiss")
        }
        .padding(12)
        .frame(maxWidth: 560)
        .pokiGlass(in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
