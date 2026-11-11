import SwiftUI
import UIKit

/// What a long press on a task's steps opens: the plan as the chat showed it, then every action and
/// approval of that run from the Activity Log, with its time, app and result. The menu copies it.
struct RunDetailsView: View {
    var title: String
    var steps: [PlanStep]
    /// Oldest first.
    var actions: [ActionLog.Entry]
    @Environment(\.dismiss) private var dismiss

    /// The whole run as text, for Copy and Share.
    static func text(title: String, steps: [PlanStep], actions: [ActionLog.Entry]) -> String {
        var lines = [title]
        if !steps.isEmpty {
            lines.append("")
            lines += steps.map { step in
                let mark = switch step.state { case .done: "[done]"; case .failed: "[failed]"; case .waiting: "[waiting]"; case .current: "[running]" }
                return "\(mark) \(step.text)"
            }
        }
        if !actions.isEmpty {
            lines.append("")
            lines += actions.map(\.line)
        }
        return lines.joined(separator: "\n")
    }

    private var text: String { Self.text(title: title, steps: steps, actions: actions) }

    var body: some View {
        NavigationStack {
            List {
                if !steps.isEmpty {
                    Section("Steps") {
                        ForEach(steps) { step in
                            Label {
                                Text(verbatim: step.text)
                            } icon: {
                                switch step.state {
                                case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                                case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                                case .waiting: Image(systemName: "hourglass").foregroundStyle(.orange)
                                case .current: Image(systemName: "circle.dotted").foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                Section {
                    if actions.isEmpty {
                        Text("No actions were recorded for these steps.").foregroundStyle(.secondary)
                    }
                    ForEach(actions) { entry in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Image(systemName: entry.kind == .approval ? (entry.ok ? "checkmark.shield.fill" : "xmark.shield.fill")
                                      : (entry.ok ? "checkmark.circle.fill" : "xmark.circle.fill"))
                                    .foregroundStyle(entry.ok ? Color.green : Color.red)
                                Text(ActivityWords.label(entry.text))
                                Spacer(minLength: 4)
                                Text(entry.at.formatted(date: .omitted, time: .standard))
                                    .font(.footnote).monospacedDigit().foregroundStyle(.secondary)
                            }
                            if let app = entry.app { Text(verbatim: app).font(.footnote).foregroundStyle(.secondary) }
                            if let detail = entry.detail { Text(verbatim: detail).font(.footnote).foregroundStyle(entry.ok ? Color.secondary : Color.orange) }
                            if let why = entry.why { Text(verbatim: why).font(.footnote).foregroundStyle(.secondary) }
                            if entry.kind == nil, entry.text != ActivityWords.label(entry.text) {
                                Text(verbatim: entry.text).font(.caption.monospaced()).foregroundStyle(.secondary)
                            }
                        }
                        .contextMenu {
                            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = entry.line }
                        }
                    }
                } header: {
                    Text("Actions")
                } footer: {
                    Text("Typed text and passwords are never kept in the log.")
                }
            }
            .navigationTitle(Text(verbatim: title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button("Copy Details", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
                        Button("Copy Diagnostic Log", systemImage: "doc.text") { UIPasteboard.general.string = AppLog.shared.text }
                        ShareLink(item: text) { Label("Share", systemImage: "square.and.arrow.up") }
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
