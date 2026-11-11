import SwiftUI

/// A status word and the colour of its dot.
struct Health {
    var word: String
    var color: Color
    static let off = Color.white.opacity(0.48)

    @MainActor static func relay(_ model: AppModel) -> Health {
        switch model.relayStatus {
        case .ready: Health(word: String(localized: "Online"), color: Site.ok)
        case .connecting: Health(word: String(localized: "Connecting"), color: .white)
        case .offline: Health(word: String(localized: "Offline"), color: Site.bad)
        case .off: Health(word: String(localized: "Off"), color: off)
        }
    }

    @MainActor static func runner(_ model: AppModel) -> Health {
        guard model.sessionOn else { return Health(word: String(localized: "Off"), color: off) }
        let runner = model.runner
        let word = Bundle.main.localizedString(forKey: runner.title, value: runner.title, table: nil)
        if runner.isRunning { return Health(word: word, color: Site.ok) }
        if runner.state == "failed" { return Health(word: word, color: Site.bad) }
        return Health(word: word, color: model.runnerPaused ? off : .white)
    }

    @MainActor static func loopback(_ model: AppModel) -> Health {
        let monitor = model.loopback
        switch monitor.state {
        case .working: return Health(word: String(localized: "On"), color: Site.ok)
        case .checking: return Health(word: String(localized: "Checking…"), color: .white)
        case .noAnswer: return Health(word: monitor.cellularRefused ? String(localized: "Needs Wi-Fi") : String(localized: "No Answer"), color: Site.bad)
        case .off: return Health(word: String(localized: "Off"), color: Site.bad)
        }
    }
}

/// Something that keeps agents from using the phone, with the one thing the person has to do.
struct Issue: Identifiable {
    enum Fix { case setup, settings, retry, none }
    var id: String
    var title: String
    var text: String
    var fix: Fix

    var button: LocalizedStringKey? {
        switch fix {
        case .setup: "Open Setup"
        case .settings: "Open Settings"
        case .retry: "Try Again"
        case .none: nil
        }
    }

    @MainActor func act(_ model: AppModel, openSetup: () -> Void) {
        switch fix {
        case .setup: openSetup()
        case .settings: if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        case .retry: model.runnerPaused ? model.wakeRunner() : model.restartRunner()
        case .none: break
        }
    }

    /// Text from PokiCore and the launcher stays as it came; Poki's own sentences are localized.
    private static func local(_ text: String) -> String { Bundle.main.localizedString(forKey: text, value: text, table: nil) }

    @MainActor static func current(_ model: AppModel) -> [Issue] {
        var out: [Issue] = []
        if model.sessionOn {
            let runner = model.runner
            if runner.state == "failed", model.pairingTrouble == nil {
                let fix = runner.fix ?? ""
                let kind: Fix = switch runner.code {
                case "runner", "pairing", "handshake", "unreachable", "ddi_refused": .setup
                case "developer_mode", "no_cryptexd", "ios_too_old", "runner_blocked": .settings
                default: .retry
                }
                out.append(Issue(id: "runner", title: String(localized: "The runner stopped"),
                                 text: fix.isEmpty ? (runner.detail.map { "\($0.prefix(1).uppercased())\($0.dropFirst())." } ?? String(localized: "Poki starts it again on the next agent request.")) : local(fix), fix: kind))
            } else if runner.state == "waiting_network", let fix = runner.fix, fix.contains("internet") {
                out.append(Issue(id: "network", title: String(localized: "Waiting for the internet"), text: local(fix), fix: .none))
            } else if model.loopback.cellularRefused {
                // A session already running keeps going on cellular; only a start from cellular is refused.
                if !runner.isRunning {
                    out.append(Issue(id: "cellular", title: String(localized: "Connect to Wi-Fi first"), text: LoopbackMonitor.cellularHint, fix: .none))
                }
            } else if runner.state == "waiting_network" || !model.loopback.isWorking && model.loopback.state != .checking {
                out.append(Issue(id: "loopback", title: String(localized: "Loopback is off"),
                                 text: String(localized: "Turn on your proxy app with the Poki module, or connect LocalDevVPN."), fix: .setup))
            }
            if let trouble = model.pairingTrouble {
                out.append(Issue(id: "pairing", title: String(localized: "Pair this iPhone again"),
                                 text: String(localized: "The phone no longer accepts Poki’s pairing (\(trouble)). Pair again in Setup; it takes a minute."), fix: .setup))
            }
            if model.passcodeHint {
                out.append(Issue(id: "passcode", title: String(localized: "Enter the passcode if the iPhone asks"),
                                 text: model.automationPath == .inProcess
                                    ? String(localized: "iOS asks for the passcode to allow UI Automation after Poki restarts, or 8 hours after it was last entered. Enter it once; Poki carries on by itself.")
                                    : String(localized: "iOS asks for the passcode before UI Automation after Poki Runner was force-closed or the iPhone restarted. Enter it once; Poki carries on by itself."), fix: .none))
            }
            if let text = model.handoffText {
                out.append(Issue(id: "handoff", title: String(localized: "Your turn"),
                                 text: String(localized: "\(text). The agent waits and sends nothing until you tap Done on the Live Activity."), fix: .none))
            }
            if case .offline = model.relayStatus {
                out.append(Issue(id: "relay", title: String(localized: "Agents can’t reach this iPhone"),
                                 text: String(localized: "Poki is offline. Check that the phone has internet; Poki reconnects by itself."), fix: .none))
            }
            if model.background.denied {
                out.append(Issue(id: "location", title: String(localized: "Poki can’t stay on in the background"),
                                 text: String(localized: "Allow location access for Poki (Settings › Poki › Location › Always). Poki uses it only to keep running; it never records where you are."), fix: .settings))
            }
        }
        // With Poki off, the old Home said this in its subtitle: a start from cellular alone is refused.
        if !model.sessionOn, model.loopback.cellularRefused {
            out.append(Issue(id: "cellular", title: String(localized: "Connect to Wi-Fi first"), text: LoopbackMonitor.cellularHint, fix: .none))
        }
        if let problem = model.problem {
            out.append(Issue(id: "problem", title: String(localized: "Needs attention"), text: local(problem), fix: problem.contains("Pair") || problem.contains("disk image") || problem.contains("Setup") ? .setup : .none))
        }
        if let problem = model.activityProblem {
            out.append(Issue(id: "activity", title: String(localized: "Live Activity is off"), text: local(problem), fix: .settings))
        }
        return out
    }
}
