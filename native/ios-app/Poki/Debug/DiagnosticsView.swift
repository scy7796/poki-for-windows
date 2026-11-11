import SwiftUI

/// Diagnostics, under Setup › Advanced: the proxy's loopback interface, the connection checks and
/// the phone's addresses. The log has its own page, and switches being tried are in Testing Options.
struct DiagnosticsView: View {
    @Binding var path: [SettingsRoute]
    @State private var results: [ProbeResult] = []
    @State private var running = false
    @State private var addresses: [LocalAddress] = localAddresses()
    @Environment(AppModel.self) private var model

    var body: some View {
        Form {
            Section {
                if let loop = loopbackInterface(addresses) {
                    Text(verbatim: "\(loop.interface)  \(loop.address)").font(.body.monospaced().weight(.semibold))
                    Text(loop.ipv6.isEmpty ? "No IPv6 on this interface" : "IPv6 present: \(loop.ipv6.joined(separator: ", "))")
                        .font(.footnote.monospaced()).foregroundStyle(loop.ipv6.isEmpty ? Color.secondary : Color.red)
                } else {
                    Text("No interface has a 10.7.0.x address. Check that your proxy app is on and its loopback module is enabled.")
                }
            } header: {
                Text("Proxy Loopback Interface")
            } footer: {
                Text(verbatim: "Network path: \(model.loopback.pathSummary). Wi-Fi \(model.loopback.wifiUp ? "up" : "down"), cellular \(model.loopback.cellularUp ? "up" : "down")\(model.loopback.cellularOnly ? " (cellular only)" : "")")
                    .textSelection(.enabled)
            }
            .textSelection(.enabled)
            Section("Checks") {
                ForEach(results) { r in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(Self.title(r)).font(.subheadline.weight(.semibold))
                        Text(verbatim: "\(r.target)  \(r.milliseconds) ms").font(.caption.monospaced()).foregroundStyle(Color(.secondaryLabel))
                        if !r.detail.isEmpty { Text(verbatim: r.detail).font(.caption.monospaced()) }
                        if !r.firstBytes.isEmpty { Text(verbatim: "first bytes: \(r.firstBytes)").font(.caption.monospaced()) }
                    }
                    .textSelection(.enabled)
                }
                Button(running ? "Running…" : "Run Checks") { Task { await run() } }.disabled(running)
            }
            Section("Addresses") {
                ForEach(addresses.indices, id: \.self) { i in
                    Text(verbatim: "\(addresses[i].interface)  \(addresses[i].address)").font(.caption.monospaced())
                }
            }
            .textSelection(.enabled)
        }
        .navigationTitle("Diagnostics")
        .navigationBarTitleDisplayMode(.inline)
        .task { await run() }
    }

    /// "Reflected lockdown: Connected", the probe's own words with the address left to the line below.
    static func title(_ r: ProbeResult) -> String {
        let label = r.label.replacingOccurrences(of: " (10.7.0.1)", with: "")
        let outcome = r.outcome.prefix(1).uppercased() + r.outcome.dropFirst()
        func local(_ s: String) -> String { Bundle.main.localizedString(forKey: s, value: s, table: nil) }
        return String(localized: "\(local(label)): \(local(outcome))")
    }

    private func run() async {
        running = true
        addresses = localAddresses()
        results = await runChecks()
        running = false
    }
}

/// Poki's log, newest first, with Clear.
struct LogView: View {
    @State private var log = AppLog.shared
    var back: () -> Void
    var body: some View {
        List {
            ForEach(Array(log.lines.reversed().enumerated()), id: \.offset) { _, line in
                Text(verbatim: line).font(.caption.monospaced()).textSelection(.enabled)
            }
        }
        .listStyle(.plain)
        .overlay { if log.lines.isEmpty { ContentUnavailableView("No Log Yet", systemImage: "doc.text") } }
        .navigationTitle("Log")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Copy Log", systemImage: "doc.on.doc") { UIPasteboard.general.string = log.text }
                    ShareLink(item: log.text, subject: Text("Poki log")) { Label("Share Log", systemImage: "square.and.arrow.up") }
                    Button("Clear", systemImage: "trash", role: .destructive) { log.clear() }
                } label: {
                    Image(systemName: "ellipsis.circle").accessibilityLabel(Text("More"))
                }
            }
        }
    }
}

/// Setup › Advanced › Testing Options: switches being tried, all in one place. Ask Before Sensitive
/// Steps and the Auto-Classifier are in Agents › Approvals.
struct TestingOptionsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(NativeServicesWDA.inputWithoutScreenSharingKey) private var bareInput = false
    var body: some View {
        @Bindable var model = model
        Form {
            AutomationMethodSection()
            Section {
                Toggle("ask_poki Tool", isOn: $model.askPokiTool)
            } header: {
                Text("Agents")
            } footer: {
                Text("Off by default. ask_poki lets outside agents hand a repetitive task to Poki's own agent. Changes take effect the next time Poki opens. The Auto-Classifier is in Agents › Approvals.")
            }
            Section {
                Toggle("Input Without Screen Sharing", isOn: $bareInput)
            } header: {
                Text("Touches and Keys")
            } footer: {
                Text("Poki sends touches and keys over a screen-sharing session, and iOS turns the camera off in every app while one is open, so Poki opens it only for an action and closes it 5 seconds after the last one. With this on, Poki opens no session at all. If taps and typing still work, the camera is never affected; if they stop working, turn it off. Takes effect the next time Poki turns on.")
            }
            Section {
                NavigationLink("Live Activity Preview") { ActivityPreview() }
            }
        }
        .navigationTitle("Testing Options")
        .navigationBarTitleDisplayMode(.inline)
    }
}
