import XCTest
@testable import PokiCore

/// A runner that misbehaves the way real ones do: slow answers, answers that never come, refused
/// connections (the runner died), lost sessions and errors, chosen by a seeded generator so a failing
/// run can be replayed. Everything else is answered by the FakeWDA underneath.
final class ChaosRunner: HTTPTransport, @unchecked Sendable {
    let base: FakeWDA
    private let rng: LockedBox<UInt64>
    private let counts = LockedBox<[String: Int]>([:])
    /// While true, every request is answered normally (to check recovery).
    let calm = LockedBox(false)

    init(base: FakeWDA, seed: UInt64) {
        self.base = base
        rng = LockedBox(seed)
    }

    private func next() -> Double {
        rng.update { state -> Double in
            // SplitMix64.
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return Double((z ^ (z >> 31)) >> 11) / Double(1 << 53)
        }
    }

    var tally: [String: Int] { counts.value }
    private func count(_ kind: String) { counts.update { $0[kind, default: 0] += 1 } }
    /// Every request with what was done to it and when (for the print when a call runs late).
    let trace = LockedBox<[String]>([])
    private let began = Date()

    func send(method: String, url: URL, body: Data?, timeout: Double) async throws -> (status: Int, body: Data) {
        if calm.value { return try await base.send(method: method, url: url, body: body, timeout: timeout) }
        let roll = next()
        let kind = roll < 0.05 ? "hang" : roll < 0.10 ? "refused" : roll < 0.13 ? "lost session" : roll < 0.18 ? "error 500" : roll < 0.30 ? "slow" : "normal"
        let at = Date().timeIntervalSince(began)
        trace.update { $0.append(String(format: "%8.2f %@ %@ %@ (timeout %.1f)", at, method, url.path, kind, timeout)) }
        defer { trace.update { $0.append(String(format: "%8.2f   done %@ %@ after %.2f s", Date().timeIntervalSince(began), method, url.path, Date().timeIntervalSince(began) - at)) } }
        switch roll {
        case ..<0.05:
            count("hang")
            try await Task.sleep(nanoseconds: 60_000_000_000)  // cancelled by the deadline
            throw TransportError.timedOut
        case ..<0.10:
            count("refused")
            throw TransportError.refused
        case ..<0.13:
            count("lost session")
            return (404, (["value": ["error": "invalid session id", "message": "Session does not exist"]] as JSON).data())
        case ..<0.18:
            count("error 500")
            return (500, (["value": ["error": "unknown error", "message": "the app crashed"]] as JSON).data())
        case ..<0.30:
            count("slow")
            try await Task.sleep(nanoseconds: UInt64((0.1 + next() * 1.4) * 1e9))
            return try await base.send(method: method, url: url, body: body, timeout: timeout)
        default:
            count("normal")
            return try await base.send(method: method, url: url, body: body, timeout: timeout)
        }
    }
}

/// A launcher stand-in: a restart makes the runner `.starting` for a moment, then `.running` again.
final class RestartingHost: CoreHost, @unchecked Sendable {
    let base = FakeHost()
    let startingUntil = LockedBox<Date?>(nil)
    let restarts = LockedBox(0)
    func signingKey() throws -> RelayKey { try base.signingKey() }
    func accessHashes() -> [String] { base.accessHashes() }
    func jpeg(fromPNG png: Data, width: Int, quality: Double) throws -> Data { try base.jpeg(fromPNG: png, width: width, quality: quality) }
    func recognizeText(inPNG png: Data) async -> [RecognizedText]? { await base.recognizeText(inPNG: png) }
    func runnerState() -> RunnerState {
        if let until = startingUntil.value, Date() < until { return .starting("relaunching the runner") }
        return .running
    }
    func restartRunner() {
        restarts.update { $0 += 1 }
        startingUntil.value = Date().addingTimeInterval(0.4)
    }
}

final class SoakTests: XCTestCase {
    /// Hundreds of mixed calls against a misbehaving runner: every call answers within its deadline,
    /// one call never blocks the next, and once the runner behaves again everything works.
    func testNoCallOutlivesItsDeadlineAgainstAMisbehavingRunner() async throws {
        let seed = UInt64(ProcessInfo.processInfo.environment["POKI_SOAK_SEED"] ?? "") ?? 20261106
        let calls = Int(ProcessInfo.processInfo.environment["POKI_SOAK_CALLS"] ?? "") ?? 120
        let wda = FakeWDA()
        wda.source([("Button", "General"), ("Button", "Privacy"), ("TextField", "Search"), ("Cell", "Wi-Fi"), ("Cell", "Bluetooth"), ("Cell", "Battery")])
        let chaos = ChaosRunner(base: wda, seed: seed)
        let host = RestartingHost()
        var config = CoreConfig(approvalWait: 0.3, toolDeadline: 4, actionCap: 2, readTimeout: 1, busyWait: 0.2, runnerWait: 1, treeFormat: "json", humanize: false) // the fake speaks JSON
        config.sensitive.enabled = false
        let core = PokiCore(config: config, host: host, transport: chaos)
        // Keep the normal-answer budget separate from the emergency backstop in Core.call. The
        // backstop is deliberately looser; the explicit assertion below still verifies it never
        // answers. This tighter limit catches calls that drift well past their normal budget even
        // when they happen to finish before the backstop.
        let limit = config.toolDeadline + config.approvalWait + 1.5

        let menu: [(String, JSON)] = [
            ("look", [:]),
            ("look", ["full": true]),
            ("do", ["actions": [["tap": 1]]]),
            ("do", ["actions": [["tap": [195, 300]], ["wait": 100]]]),
            ("do", ["actions": [["type": "hello", "ref": 3]]]),
            ("do", ["actions": [["type": "x", "clear": true]]]),
            ("do", ["actions": [["swipe": "up"]]]),
            ("do", ["actions": [["scroll_to": "Battery"]]]),
            ("do", ["actions": [["wait_until": "Wi-Fi"]]]),
            ("do", ["actions": [["key": "return"], ["button": "home"]]]),
            ("do", ["actions": [["launch": "com.apple.Preferences"]]]),
            ("status", [:]),
        ]
        var slowest = 0.0, errors = 0
        var outcomes: [String: Int] = [:]
        for i in 0..<calls {
            let (name, args) = menu[i % menu.count]
            let started = Date()
            let result: ToolResult
            if i % 17 == 5 {
                // Two at once: the second waits briefly or answers busy, never hangs behind the first.
                async let a = core.call(name, args)
                async let b = core.call("look", [:])
                let (first, second) = await (a, b)
                result = first
                XCTAssertLessThan(Date().timeIntervalSince(started), limit, "call \(i) (pair): \(second.text.prefix(120))")
            } else {
                result = await core.call(name, args)
            }
            let took = Date().timeIntervalSince(started)
            slowest = max(slowest, took)
            XCTAssertLessThan(took, limit, "call \(i) \(name) \(args.serialized()) took \(took) s: \(result.text.prefix(200))")
            XCTAssertFalse(result.text.isEmpty, "call \(i) answered nothing")
            // Every step has its own deadline, so the outer backstop ("did not finish … what was sent
            // is unknown") must never be what answers: the agent always gets facts.
            XCTAssertFalse(result.text.contains("did not finish within") && result.text.hasPrefix("error:"), "call \(i) \(name) \(args.serialized()) hit the backstop after \(String(format: "%.2f", took)) s: \(result.text.prefix(200))")
            if took > config.toolDeadline + 0.5 {
                print("soak: call \(i) \(name) \(args.serialized()) took \(String(format: "%.2f", took)) s: \(result.text.prefix(300))")
                print("soak: requests during call \(i):\n" + chaos.trace.value.suffix(40).joined(separator: "\n"))
            }
            chaos.trace.value = []
            if result.isError { errors += 1 }
            let first = result.text.split(separator: "\n").first.map(String.init) ?? ""
            let kind = first.hasPrefix("app:") ? "read" : String(first.prefix(24))
            outcomes[kind, default: 0] += 1
        }

        // The runner behaves again: within a couple of calls everything works, nothing is left held.
        chaos.calm.value = true
        host.startingUntil.value = nil
        var recovered: ToolResult?
        for _ in 0..<3 {
            let r = await core.call("look", [:])
            if !r.isError { recovered = r; break }
        }
        XCTAssertNotNil(recovered, "no recovery once the runner behaved")
        let status = await core.call("status", [:])
        XCTAssertFalse(status.text.contains("running: "), "the gate was left held: \(status.text)")
        let tap = await core.call("do", ["actions": [["tap": 1]]])
        XCTAssertFalse(tap.isError, tap.text)

        print("soak: seed \(seed), \(calls) calls, slowest \(String(format: "%.2f", slowest)) s (limit \(limit) s), \(errors) answered with isError, restarts asked \(host.restarts.value)")
        print("soak: runner behaviour \(chaos.tally.sorted { $0.key < $1.key })")
        print("soak: first lines \(outcomes.sorted { $0.value > $1.value }.prefix(8))")
        XCTAssertGreaterThan(chaos.tally["hang", default: 0], 0, "the run had no hangs to survive")
    }

    /// A runner that is consistently slow can make several sequential parts of a read add up beyond
    /// the normal call budget. The soak above uses bursty chaos (a hang, refusal, then normal answer)
    /// and did not reliably exercise that shape. The old code let a read budgeted `readTimeout` (1 s)
    /// take 2.3-3.4 s; a 4 s `do` could then exceed the 5.8 s normal budget, and at higher latency
    /// hit the emergency backstop with "what was sent is unknown".
    ///
    /// The curve is not monotonic: a request slower than its own timeout is cut off and may end the
    /// step early. The failing band is just below step timeouts, where sequential work is slow but
    /// requests still complete. Assert against the normal budget, not the looser emergency backstop,
    /// so this test also catches overruns that finish without invoking the backstop.
    func testASlowRunnerStaysWithinTheNormalCallBudget() async throws {
        for perRequest in [0.4, 0.6, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 2.0] {
            var config = CoreConfig(approvalWait: 0.3, toolDeadline: 4, actionCap: 2, readTimeout: 1, busyWait: 0.2, runnerWait: 1, treeFormat: "json", humanize: false)
            config.sensitive.enabled = false
            let core = PokiCore(config: config, host: FakeHost(), transport: SlowTransport(perRequest: perRequest))
            for (name, args) in [("look", JSON.object([:])),
                                 ("do", ["actions": [["tap": 1]]]),
                                 ("do", ["actions": [["launch": "com.apple.Preferences"]]]),
                                 ("do", ["actions": [["type": "hello", "ref": 3]]])] {
                let normalLimit = config.toolDeadline + (name == "do" ? config.approvalWait : 0) + 1.5
                let started = Date()
                let result = await core.call(name, args)
                let took = Date().timeIntervalSince(started)
                XCTAssertLessThan(took, normalLimit, "call \(name) took \(String(format: "%.2f", took)) s against the \(normalLimit) s normal budget with every request answered in \(perRequest) s: \(result.text.prefix(200))")
                // The point: the agent gets facts about the screen, not the backstop's "what was sent
                // is unknown" — which is what a slow runner used to produce here.
                XCTAssertFalse(result.text.contains("did not finish within") && result.text.hasPrefix("error:"), "the backstop answered a \(perRequest) s runner: \(result.text.prefix(200))")
                XCTAssertFalse(result.text.isEmpty, "\(name) at \(perRequest) s answered nothing")
            }
        }
    }
}

/// A runner that answers every request after the same delay, and does not answer at all the ones that
/// would take longer than the timeout they were given (the transport's own `.timedOut`). The failing
/// reads matter: a read that succeeds never runs its recovery paths, and those paths are where the
/// deadline used to be lost.
final class SlowTransport: HTTPTransport, @unchecked Sendable {
    let perRequest: Double
    init(perRequest: Double) { self.perRequest = perRequest }
    func send(method: String, url: URL, body: Data?, timeout: Double) async throws -> (status: Int, body: Data) {
        try? await Task.sleep(nanoseconds: UInt64(max(0, min(perRequest, timeout)) * 1e9))
        if perRequest > timeout { throw TransportError.timedOut }
        let path = url.path
        let value: JSON
        switch (method, path) {
        case ("POST", let p) where p.hasSuffix("/session"): value = ["sessionId": .string("s1")]
        case ("GET", let p) where p.hasSuffix("/source"):
            value = ["value": ["type": .string("XCUIElementTypeApplication"), "label": .string("Settings"),
                               "rect": ["x": .number(0), "y": .number(0), "width": .number(390), "height": .number(844)],
                               "children": .array([])]]
        case ("GET", let p) where p.hasSuffix("/screenshot"): value = ["value": .string(Data("png".utf8).base64EncodedString())]
        case ("GET", let p) where p.hasSuffix("/wda/activeAppInfo"):
            value = ["value": ["bundleId": .string("com.apple.Preferences"), "name": .string("Settings")]]
        case ("GET", let p) where p.hasSuffix("/wda/locked"): value = ["value": .bool(false)]
        case ("GET", let p) where p.hasSuffix("/wda/screen"): value = ["screenSize": ["width": .number(390), "height": .number(844)]]
        case ("GET", let p) where p.hasSuffix("/status"): value = ["value": ["ready": .bool(true)]]
        default: value = ["value": .null]
        }
        return (200, value.data())
    }
}
