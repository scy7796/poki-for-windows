import CryptoKit
import XCTest
@testable import Poki

/// The installer on the Mac (bin/install-iphone.mjs) and Poki talk through Documents/PokiSetup/.
/// These run Poki's side with what the installer writes: a hello it can read, a model key sealed to
/// the phone's key, and Poki turning on by itself after a Poki Setup install.
@MainActor
final class HandoffTests: XCTestCase {
    private var saved: (provider: Any?, wantsOn: Any?, openai: String?)!

    override func setUp() async throws {
        saved = (UserDefaults.standard.object(forKey: "chat.provider"), UserDefaults.standard.object(forKey: "wantsOn"), ModelKeys.key(.openai))
        PokiHandoff.forget()
    }

    override func tearDown() async throws {
        PokiHandoff.forget()
        try? FileManager.default.removeItem(at: SelfSigner.handedIdentity)
        UserDefaults.standard.set(saved.provider, forKey: "chat.provider")
        UserDefaults.standard.set(saved.wantsOn, forKey: "wantsOn")
        if let key = saved.openai { try ModelKeys.save(key, for: .openai) } else { ModelKeys.remove(.openai) }
    }

    private func hello() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: PokiHandoff.helloFile)) as? [String: Any])
    }

    /// What src/install/model-key.mjs writes, made here with the same construction.
    private func sealed(_ secret: String, provider: String, to publicKey: P256.KeyAgreement.PublicKey) throws -> Data {
        let sender = P256.KeyAgreement.PrivateKey()
        let epk = sender.publicKey.x963Representation
        let header = ["schema": ModelKeySeal.schema, "key_id": ModelKeySeal.keyID(publicKey), "provider": provider,
                      "bundle_id": Bundle.main.bundleIdentifier ?? "", "expires_at": ISO8601DateFormatter().string(from: Date().addingTimeInterval(600))]
        let key = try sender.sharedSecretFromKeyAgreement(with: publicKey)
            .hkdfDerivedSymmetricKey(using: SHA256.self, salt: epk + publicKey.x963Representation, sharedInfo: Data(ModelKeySeal.schema.utf8), outputByteCount: 32)
        let aad = Data(["schema", "key_id", "provider", "bundle_id", "expires_at"].map { header[$0]! }.joined(separator: "\n").utf8)
        let box = try AES.GCM.seal(try JSONSerialization.data(withJSONObject: ["secret": secret]), using: key, authenticating: aad)
        var envelope = header
        envelope["epk"] = epk.base64URL
        envelope["nonce"] = Data(box.nonce).base64URL
        envelope["ct"] = (box.ciphertext + box.tag).base64URL
        return try JSONSerialization.data(withJSONObject: envelope)
    }

    /// A model key the installer sealed to this phone is taken once: it becomes the chat's key, the file
    /// goes, the hello says which key took it, and the next hello offers a new key.
    func testASealedModelKeyIsTakenOnceAndTheHelloSaysSo() throws {
        do {
            try Keychain.write(Data("probe".utf8), account: "handoff.probe")
            Keychain.delete("handoff.probe")
        } catch {
            throw XCTSkip("this test host has no keychain (an unsigned build): \(error)")
        }
        let model = AppModel(launcher: FakeLauncher(), pairer: FakePairing())
        model.handoffTick()
        let offer = try XCTUnwrap(try hello()["model_key"] as? [String: String])
        let publicKey = try P256.KeyAgreement.PublicKey(x963Representation: XCTUnwrap(Data(base64URL: XCTUnwrap(offer["public_key"]))))
        XCTAssertEqual(offer["key_id"], ModelKeySeal.keyID(publicKey))
        let secret = "sk-proj-FAKEhandoffKEY0123456789"
        try sealed(secret, provider: "openai", to: publicKey).write(to: PokiHandoff.sealedKeyFile)

        model.handoffTick()
        XCTAssertEqual(ModelKeys.key(.openai), secret)
        XCTAssertEqual(ModelKeys.selectedProvider, .openai)
        XCTAssertFalse(FileManager.default.fileExists(atPath: PokiHandoff.sealedKeyFile.path), "the sealed file is gone")
        let after = try hello()
        XCTAssertEqual((after["imported"] as? [String: String])?["key_id"], offer["key_id"])
        XCTAssertNotEqual((after["model_key"] as? [String: String])?["key_id"], offer["key_id"], "a key pair opens one sealed key")
        XCTAssertFalse(String(decoding: try Data(contentsOf: PokiHandoff.helloFile), as: UTF8.self).contains(secret))
        XCTAssertFalse(model.log.text.contains(secret), "the log names the provider, never the key")

        // The same file again (a copy someone kept) no longer opens: its phone key is gone.
        try sealed(secret, provider: "openai", to: publicKey).write(to: PokiHandoff.sealedKeyFile)
        ModelKeys.remove(.openai)
        model.handoffTick()
        XCTAssertNil(ModelKeys.key(.openai))
        XCTAssertFalse(FileManager.default.fileExists(atPath: PokiHandoff.sealedKeyFile.path))
    }

    /// The hello tells the installer whether the local connection answers, and the one sentence for the
    /// person when it does not.
    func testTheHelloSaysWhetherTheLocalConnectionAnswers() throws {
        let model = AppModel(launcher: FakeLauncher(), pairer: FakePairing())
        model.loopback.simulate(.off)
        model.handoffTick()
        let off = try XCTUnwrap(try hello()["loopback"] as? [String: Any])
        XCTAssertEqual(off["working"] as? Bool, false)
        XCTAssertEqual(off["say"] as? String, model.loopbackSentence)
        XCTAssertTrue(model.loopbackSentence.contains("Connect to this iPhone") || model.loopbackSentence.contains("10.7.0.1"))
        model.loopback.simulate(.working(ms: 9))
        model.handoffTick()
        XCTAssertEqual((try hello()["loopback"] as? [String: Any])?["working"] as? Bool, true)
    }

    /// Installed by Poki Setup (its signing key waits in the container) and never turned on or off: Poki
    /// turns on by itself. Without Poki Setup's install, a new Poki waits for the owner.
    func testAPokiSetupInstallTurnsPokiOnByItself() throws {
        UserDefaults.standard.removeObject(forKey: "wantsOn")
        XCTAssertFalse(AppModel(launcher: FakeLauncher(), pairer: FakePairing()).wantsOn)

        try FileManager.default.createDirectory(at: SelfSigner.handedIdentity.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: SelfSigner.handedIdentity)
        UserDefaults.standard.removeObject(forKey: "wantsOn")
        XCTAssertTrue(AppModel(launcher: FakeLauncher(), pairer: FakePairing()).wantsOn)

        UserDefaults.standard.set(false, forKey: "wantsOn")
        XCTAssertFalse(AppModel(launcher: FakeLauncher(), pairer: FakePairing()).wantsOn, "an owner who turned Poki off keeps it off")
    }
}
