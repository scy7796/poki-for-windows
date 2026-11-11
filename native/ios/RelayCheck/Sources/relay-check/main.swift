import Crypto
import Foundation
import PokiCore

// relay-check <relay address> [seconds]: connects as a phone, prints the connector URL on one line
// ("connector: …"), the relay states, and each tool call, then exits after `seconds`. The address is
// the one entered in Poki, such as https://poki-relay.you.workers.dev, or http://127.0.0.1:8787 for
// wrangler dev.
let args = CommandLine.arguments
guard args.count > 1, let relay = RelayAddress(args[1]) else {
    FileHandle.standardError.write(Data("usage: relay-check <relay address, such as https://poki-relay.you.workers.dev> [seconds]\n".utf8))
    exit(2)
}
let seconds = args.count > 2 ? Double(args[2]) ?? 60 : 60

struct Key: RelayKey {
    let key: Curve25519.Signing.PrivateKey
    var publicKey: Data { key.publicKey.rawRepresentation }
    func sign(_ message: Data) throws -> Data { try key.signature(for: message) }
}

final class Host: CoreHost, @unchecked Sendable {
    let key = Key(key: Curve25519.Signing.PrivateKey())
    let secret: String = {
        var bytes = [UInt8](repeating: 0, count: 32)
        for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }()
    func signingKey() throws -> RelayKey { key }
    func accessHashes() -> [String] { [SHA256.hash(data: Data(secret.utf8)).map { String(format: "%02x", $0) }.joined()] }
    func jpeg(fromPNG png: Data, width: Int, quality: Double) throws -> Data { png }
    func runnerState() -> RunnerState { .running }
    func restartRunner() {}
}

let host = Host()
// Nothing listens on port 1: the runner calls are refused at once.
let core = PokiCore(config: CoreConfig(runnerURL: URL(string: "http://127.0.0.1:1")!), host: host)
let label = base32(host.key.publicKey)
print("connector: \(relay.connectorBase.absoluteString)/\(label)/\(host.secret)/mcp")
fflush(stdout)
Task {
    for await event in core.events {
        switch event {
        case .relay(let state): print("relay: \(state)")
        case .toolStarted(let a): print("tool started: \(a.name) \(a.summary)")
        case .toolFinished(let a, let outcome, _): print("tool finished: \(a.name) \(outcome)")
        default: print("event: \(event)")
        }
        fflush(stdout)
    }
}
#if os(Linux)
core.start(relay: relay, socketFactory: NodeSocketFactory(node: ProcessInfo.processInfo.environment["NODE"] ?? "/usr/local/bin/node", bridge: ProcessInfo.processInfo.environment["WS_BRIDGE"] ?? "ws-bridge.mjs"))
#else
core.start(relay: relay)
#endif
Thread.sleep(forTimeInterval: seconds)
core.stop()
print("done")
