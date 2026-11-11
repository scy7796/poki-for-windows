import XCTest
@testable import PokiCore

/// Typing through Poki's keyboard (`HTTPTransport.typesThroughKeyboard`): asked first, nothing read
/// from the screen around it, and the usual way when it declines.
final class KeyboardTypingTests: XCTestCase {
    func keyboardCore(secure: Bool = false, _ answer: @escaping @Sendable (JSON?) -> (Int, JSON)) -> (PokiCore, FakeWDA) {
        let wda = FakeWDA()
        wda.typesThroughKeyboard = true
        wda.set("POST /wda/keys") { body in
            body?["keyboard"]?.bool == true ? answer(body) : (200, ["value": .null])
        }
        wda.set("POST /poki/keyboard/release") { _ in (200, ["value": .null]) }
        wda.tree(secure ? [Node("TextField", "Name", [16, 100, 358, 44], value: ""), Node("SecureTextField", "Password", [16, 160, 358, 44], value: "")]
                 : [Node("TextField", "Message", [16, 100, 358, 44], value: "")], app: "Notes")
        let (core, _, _) = makeCore(wda) { $0.toolDeadline = 12; $0.actionCap = 6 }
        return (core, wda)
    }

    /// The requests of the last call, from its first tap on.
    func sinceTap(_ wda: FakeWDA) -> [String] {
        let sent = wda.sent
        return Array(sent[(sent.lastIndex(of: "POST /wda/tap") ?? 0)...])
    }

    func testKeyboardTypesWithoutReadingForFocusOrReadBack() async {
        let (core, wda) = keyboardCore { _ in (200, ["value": ["keyboard": "typed", "check": "matched", "moved": false, "tail": "hello"]]) }
        _ = await core.call("look", [:])
        let result = await core.call("do", ["actions": [["type": "hello", "ref": 1, "clear": true]]])
        XCTAssertTrue(result.text.contains("Poki's keyboard, which confirms"), result.text)
        let requests = sinceTap(wda)
        let keys = requests.firstIndex(of: "POST /wda/keys")!
        // Nothing is read between the tap and the keys, and the text goes in one request.
        XCTAssertEqual(Array(requests[..<keys]), ["POST /wda/tap"], "\(requests)")
        XCTAssertEqual(requests.filter { $0 == "POST /wda/keys" }.count, 1)
        let body = wda.bodies("POST /wda/keys").last
        XCTAssertEqual(body?["value"]?.array?.compactMap(\.string).joined(), "hello")
        XCTAssertEqual(body?["clear"]?.bool, true)
        XCTAssertEqual(body?["focused"]?.bool, true)
        XCTAssertEqual(body?["app"]?.string, "com.apple.Preferences")
    }

    func testDeclinedFallsBackToTheUsualWay() async {
        let (core, wda) = keyboardCore { _ in (200, ["value": ["keyboard": "declined", "why": "not added"]]) }
        _ = await core.call("look", [:])
        let result = await core.call("do", ["actions": [["type": "hello", "ref": 1]]])
        XCTAssertFalse(result.isError, result.text)
        let bodies = wda.bodies("POST /wda/keys")
        XCTAssertEqual(bodies.first?["keyboard"]?.bool, true)
        let usual = bodies.dropFirst()
        XCTAssertFalse(usual.isEmpty)
        XCTAssertTrue(usual.allSatisfy { $0["keyboard"] == nil })
        XCTAssertEqual(usual.flatMap { $0["value"]?.array?.compactMap(\.string) ?? [] }.joined(), "hello")
        // The answer says why, so a keyboard that is never used is not a mystery.
        XCTAssertTrue(result.text.contains("Poki's keyboard was not used: not added"), result.text)
    }

    func testPasswordFieldsNeverAskTheKeyboard() async {
        let (core, wda) = keyboardCore(secure: true) { _ in (200, ["value": ["keyboard": "typed", "check": "mismatch", "tail": "sam@x.y"]]) }
        _ = await core.call("look", [:])
        // (Through `do` a password also waits for the owner's approval: CoreTests.)
        let password = core.computer.refs[2]
        XCTAssertEqual(password?.isSecure, true)
        let asked = try? await core.computer.typeThroughKeyboard("hunter2", clear: false, hidden: true, target: password, tapped: true, until: now() + 30)
        XCTAssertNil(asked)
        XCTAssertTrue(wda.bodies("POST /wda/keys").isEmpty)
        // The name field beside it may go through the keyboard, with nothing of the field echoed.
        let name = await core.call("do", ["actions": [["type": "sam@x.y", "ref": 1]]])
        XCTAssertEqual(wda.bodies("POST /wda/keys").last?["hidden"]?.bool, true)
        XCTAssertTrue(name.text.contains("now ends differently"), name.text)
        XCTAssertFalse(name.text.contains("sam@x.y"), name.text)
    }

    func testNotesWhatTheKeyboardCouldNotConfirm() async {
        let (core, _) = keyboardCore { _ in (200, ["value": ["keyboard": "typed", "check": "mismatch", "moved": false, "tail": "4242 4242"]]) }
        _ = await core.call("look", [:])
        let result = await core.call("do", ["actions": [["type": "42424242", "ref": 1]]])
        XCTAssertTrue(result.text.contains("now ends \"4242 4242\""), result.text)
    }

    func testTakeOverPausesForTheOwnerAndTypesNothingAgain() async {
        let (core, wda) = keyboardCore { _ in (500, ["value": ["error": "poki user takeover", "message": "The owner took over after 3 of 5 characters."]]) }
        _ = await core.call("look", [:])
        let result = await core.call("do", ["actions": [["type": "hello", "ref": 1], ["tap": [20, 20]]]])
        XCTAssertEqual(core.handoff?.ownerOnly, true)
        XCTAssertEqual(wda.bodies("POST /wda/keys").count, 1)
        XCTAssertEqual(wda.bodies("POST /wda/tap").count, 1, "the tap after the type was not sent")
        XCTAssertTrue(result.text.contains("may have been delivered"), result.text)
    }

    func testAStopPartWayIsReportedAndNotTypedAgain() async {
        let (core, wda) = keyboardCore { _ in (500, ["value": ["error": "poki typing stopped", "message": "The Poki keyboard typed 3 of 5 characters, then stopped."]]) }
        _ = await core.call("look", [:])
        let result = await core.call("do", ["actions": [["type": "hello", "ref": 1, "clear": true]]])
        XCTAssertNil(core.handoff)
        XCTAssertEqual(wda.bodies("POST /wda/keys").count, 1)
        XCTAssertTrue(result.text.contains("may have been delivered"), result.text)
        XCTAssertTrue(result.text.contains("typed 3 of 5"), result.text)
    }

    func testFinishLetsTheKeyboardGo() async {
        let (core, wda) = keyboardCore { _ in (200, ["value": ["keyboard": "typed", "check": "matched"]]) }
        _ = await core.call("look", [:])
        _ = await core.call("do", ["actions": [["type": "hello", "ref": 1]], "finish": true])
        XCTAssertTrue(wda.sent.contains("POST /poki/keyboard/release"), "\(wda.sent)")
        // A transport without the keyboard is never asked.
        let (plain, other, _) = makeCore()
        _ = await plain.call("do", ["actions": [["wait": 10]], "finish": true])
        XCTAssertFalse(other.sent.contains("POST /poki/keyboard/release"))
    }

    func testKeyboardTextsGetTimeAtAKeyboardsPace() {
        XCTAssertEqual(Computer.keyboardTypingBudget("hello"), 30.6, accuracy: 0.01)
        XCTAssertEqual(Computer.keyboardTypingBudget(String(repeating: "x", count: 2000)), 270, accuracy: 0.01)
    }
}
