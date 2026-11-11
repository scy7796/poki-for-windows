import Foundation
import Network

/// Live loopback status: every few seconds while Poki is in front (and on demand), a TCP connect to
/// developer services at 10.7.0.1, which only answer when Poki or an external VPN reflects
/// 10.7.0.1 back to this phone. Also whether Wi-Fi is up, which the phone's developer services need.
@MainActor
@Observable
final class LoopbackMonitor {
    enum State: Equatable {
        case checking
        case working(ms: Int)
        /// A tunnel gave the phone a 10.7.0.x address, but nothing answered through it.
        case noAnswer
        case off
        var isWorking: Bool { if case .working = self { true } else { false } }
    }
    private(set) var state = State.checking
    private(set) var onWiFi = false
    /// The phone's only way out is cellular. iOS refuses the developer services' loopback on cellular
    /// (remotepairingdeviced: "prohibited types: cellular loopback"), so a session cannot start from
    /// here; one that is already up keeps running when the phone moves to cellular.
    private(set) var cellularOnly = false
    /// The interfaces the system path lists, for Diagnostics: a proxy app's tunnel can change what the path reports.
    private(set) var pathSummary = ""
    private(set) var checkedAt: Date?
    /// When the loopback last stopped answering after it had worked; nil while it works.
    private(set) var droppedAt: Date?
    /// Called on every change of state, with the old and the new one.
    var onChange: ((State, State) -> Void)?
    private var timer: Timer?
    private let path = NWPathMonitor()
    private let wifiPath = NWPathMonitor(requiredInterfaceType: .wifi)
    private let cellularPath = NWPathMonitor(requiredInterfaceType: .cellular)
    private(set) var wifiUp = false
    private(set) var cellularUp = false
    private var running = false

    init() {
        // The default path's interface types change while a proxy app's tunnel is up, so "only
        // cellular" is read from two monitors that each watch one physical interface type.
        path.pathUpdateHandler = { [weak self] path in
            let wifi = path.status == .satisfied && path.usesInterfaceType(.wifi)
            let summary = "\(path.status): " + path.availableInterfaces.map { "\($0.name) (\($0.type))" }.joined(separator: ", ")
            Task { @MainActor in
                guard let self else { return }
                self.pathSummary = summary
                if self.onWiFi != wifi { self.onWiFi = wifi; self.check() }
            }
        }
        wifiPath.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor in self?.interfaceChanged { $0.wifiUp = up } }
        }
        cellularPath.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor in self?.interfaceChanged { $0.cellularUp = up } }
        }
        let queue = DispatchQueue(label: "poki.path")
        path.start(queue: queue)
        wifiPath.start(queue: queue)
        cellularPath.start(queue: queue)
    }

    private func interfaceChanged(_ update: (LoopbackMonitor) -> Void) {
        update(self)
        let only = Self.forcedCellular || (cellularUp && !wifiUp)
        if only != cellularOnly { cellularOnly = only; check() }
    }

    /// `-pokiLoopback cellular`, `working` or `noanswer`: a simulator has no cellular and no 10.7.0.x, so a screenshot sets the state by hand.
    nonisolated private static var forced: String? {
        #if targetEnvironment(simulator)
        UserDefaults.standard.string(forKey: "pokiLoopback")
        #else
        nil
        #endif
    }
    nonisolated private static var forcedCellular: Bool { forced == "cellular" }

    private static func same(_ a: State, _ b: State) -> Bool {
        switch (a, b) {
        case (.working(let x), .working(let y)): abs(x - y) < 100
        default: a == b
        }
    }

    var isWorking: Bool { state.isWorking }

    /// The tunnel is on and refuses, and the phone has only cellular: the one case where the fix is
    /// "start from Wi-Fi", not "turn the proxy app on".
    var cellularRefused: Bool { state == .noAnswer && cellularOnly }

    /// Checks every `interval` seconds until `pause` (3 s in front; the app uses a slower one in the
    /// background while an agent works, so a dropped tunnel is noticed and named).
    func resume(every interval: TimeInterval = 3) {
        if let timer, abs(timer.timeInterval - interval) < 0.5 { return }
        timer?.invalidate()
        check()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in Task { @MainActor in self?.check() } }
    }

    func pause() { timer?.invalidate(); timer = nil }

    func check() {
        guard !running else { return }
        running = true
        Task {
            var result = await probe(label: "loopback", host: "10.7.0.1", port: 49152, timeout: 1.5)
            if result.outcome != "connected" {
                result = await probe(label: "loopback", host: "10.7.0.1", port: 62078, timeout: 1.5)
            }
            running = false
            let probed: State = result.outcome == "connected" ? .working(ms: result.milliseconds) : loopbackInterface() == nil ? .off : .noAnswer
            let next = Self.forcedCellular || Self.forced == "noanswer" ? State.noAnswer : Self.forced == "working" ? State.working(ms: 5) : probed
            // Only a change is published, so the screens are not redrawn every 3 s (a redraw while
            // the person drags a list makes scrolling stutter).
            if !Self.same(next, state) {
                let old = state
                state = next; checkedAt = Date()
                if case .working = old, !isWorking { droppedAt = Date() }
                if isWorking { droppedAt = nil }
                AppLog.shared.add("loopback", "developer service: \(next)")
                onChange?(old, next)
            }
        }
    }

    #if DEBUG
    /// Tests: set the state as a probe result would, running the change hook.
    func simulate(_ next: State) {
        let old = state
        guard !Self.same(next, state) else { return }
        state = next; checkedAt = Date()
        if case .working = old, !isWorking { droppedAt = Date() }
        if isWorking { droppedAt = nil }
        onChange?(old, next)
    }
    #endif

    static var cellularHint: String { String(localized: "Connect to Wi-Fi and open Poki first. Once it is on, you can switch to cellular and keep using it.") }

    var text: String {
        switch state {
        case .checking: String(localized: "Checking…")
        case .working: String(localized: "Working")
        case .noAnswer: String(localized: "Tunnel on, no answer")
        case .off: String(localized: "Off")
        }
    }

    var detail: String {
        switch state {
        case .checking: String(localized: "Looking for this iPhone at 10.7.0.1.")
        case .working(let ms): String(localized: "This iPhone answers at 10.7.0.1 (\(ms) ms).") + (onWiFi || cellularOnly ? "" : " " + String(localized: "Connect to Wi-Fi: the developer services need it."))
        case .noAnswer where cellularOnly: Self.cellularHint
        case .noAnswer: String(localized: "The local interface is present, but this iPhone does not answer at 10.7.0.1. Reconnect the local connection and check Wi-Fi. If it still does not answer, pair again in Setup › Pairing, then check Developer Mode.")
        case .off: String(localized: "This iPhone does not answer yet. Enable Poki's local connection, or choose an external connection in Setup.")
        }
    }
}
