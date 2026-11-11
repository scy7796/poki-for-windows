import PokiCore
import UIKit
import XCTest
@testable import Poki

final class NativeServicesWDATests: XCTestCase {
    func testNativeCoordinatesRejectOutOfViewportBeforeHID() throws {
        let native = NativeServicesWDA(screen: CGSize(width: 402, height: 874))
        for (x, y) in [(-1.0, 20.0), (402.0, 20.0), (20.0, -1.0), (20.0, 874.0), (Double.nan, 20.0), (20.0, Double.infinity)] {
            let source: JSON = ["type": "pointer", "parameters": ["pointerType": "touch"], "actions": [
                ["type": "pointerMove", "x": .number(x), "y": .number(y)],
                ["type": "pointerDown"], ["type": "pointerUp"],
            ]]
            XCTAssertThrowsError(try native.finger(source), "Invalid point \(x),\(y) must not become an edge tap")
        }
    }

    func testNativeCoordinateRejectionIncludesLaterDragPointsAndInvalidViewports() throws {
        let source: JSON = ["type": "pointer", "parameters": ["pointerType": "touch"], "actions": [
            ["type": "pointerMove", "x": 10, "y": 10], ["type": "pointerDown"],
            ["type": "pointerMove", "x": 402, "y": 20, "duration": 50], ["type": "pointerUp"],
        ]]
        XCTAssertThrowsError(try NativeServicesWDA(screen: CGSize(width: 402, height: 874)).finger(source))
        let tap: JSON = ["type": "pointer", "parameters": ["pointerType": "touch"], "actions": [
            ["type": "pointerMove", "x": 0, "y": 0], ["type": "pointerDown"], ["type": "pointerUp"],
        ]]
        for size in [CGSize.zero, CGSize(width: 1, height: 874), CGSize(width: CGFloat.nan, height: 874)] {
            XCTAssertThrowsError(try NativeServicesWDA(screen: size).finger(tap))
        }
    }

    func testNativeCoordinateEndpointsAndFractionalPositionsRemainSupported() throws {
        let native = NativeServicesWDA(screen: CGSize(width: 402, height: 874))
        let source: JSON = ["type": "pointer", "parameters": ["pointerType": "touch"], "actions": [
            ["type": "pointerMove", "x": 0, "y": 0], ["type": "pointerDown"],
            ["type": "pointerMove", "x": 200.5, "y": 436.5, "duration": 25],
            ["type": "pointerMove", "x": 401, "y": 873, "duration": 25], ["type": "pointerUp"],
        ]]
        let points = try native.finger(source)
        XCTAssertEqual(points[0]["x"] as? Int, 0)
        XCTAssertEqual(points[1]["x"] as? Int, 32768)
        XCTAssertEqual(points[1]["y"] as? Int, 32768)
        XCTAssertEqual(points[2]["x"] as? Int, 65535)
        XCTAssertEqual(points[2]["y"] as? Int, 65535)
    }

    @MainActor
    func testChineseInputVerificationRejectsUnknownAndOtherLanguages() {
        for language in ["zh", "zh-Hans", "zh-Hant", "zh_CN"] {
            XCTAssertTrue(InProcessProbe.isChineseInputLanguage(language))
        }
        let otherLanguages: [String?] = [nil, "", "en-US", "ja-JP", "zhongwen"]
        for language in otherLanguages {
            XCTAssertFalse(InProcessProbe.isChineseInputLanguage(language))
        }
    }

    func testNativeIMEPreservesEditOrderWithoutPasteFallback() throws {
        let parts = try NativeIME.plan("\u{8}\u{8}中文\t姓名\n")
        XCTAssertEqual(parts.map(\.text), ["\u{8}", "\u{8}", "中文", "\t", "姓名", "\n"])
        XCTAssertTrue(parts[2].composition)
        XCTAssertEqual(parts[2].keys, "zhongwen")
        XCTAssertThrowsError(try NativeIME.plan("prefix🙂"))
    }

    func testNativeIMEUsesWordsAndLiteralUmlautConversion() throws {
        let sentence = "今天我们一起测试中文输入"
        let parts = try NativeIME.plan(sentence)
        XCTAssertEqual(parts.map(\.text).joined(), sentence)
        XCTAssertTrue(NativeIME.words(sentence).contains("我们"))
        XCTAssertEqual(try NativeIME.pinyin("选择"), "xuanze")
        XCTAssertEqual(try NativeIME.pinyin("绿色"), "lvse")
        XCTAssertEqual(try NativeIME.pinyin("女"), "nv")
    }

    func testNativeIMEVerifiesExactEdits() {
        XCTAssertTrue(NativeIME.matchesEdit(before: "ab", after: "a你好b", keys: "你好"))
        XCTAssertFalse(NativeIME.matchesEdit(before: "ab", after: "X你好b", keys: "你好"))
        XCTAssertFalse(NativeIME.matchesEdit(before: "abc", after: "a", keys: "\u{8}"))
        XCTAssertFalse(NativeIME.matchesEdit(before: "abc", after: "abc", keys: "\u{8}"))
    }

    func testCompactStatusAndGlyphShareEventColor() {
        var state = PokiState(phase: .idle, headline: "Ready", thumbnailVersion: 0)
        state.event = .init(kind: .started, text: "Started")
        let face = state.face
        guard case .text(_, let tone) = face.compact else { return XCTFail("Expected compact status") }
        XCTAssertEqual(tone, face.tone)
    }

    func testDragVelocityUsesScreenPointsNotHIDCoordinates() {
        let body: JSON = ["fromX": 201, "fromY": 300, "toX": 201, "toY": 480, "velocity": 800]
        XCTAssertEqual(NativeServicesWDA.dragMilliseconds(body), 225)
        let diagonal: JSON = ["fromX": 0, "fromY": 0, "toX": 300, "toY": 400, "velocity": 1000]
        XCTAssertEqual(NativeServicesWDA.dragMilliseconds(diagonal), 500)
        XCTAssertEqual(NativeServicesWDA.dragMilliseconds(nil), 80)
    }

    func testHumanizedPointerActionsKeepEveryPointAndRelativeTime() throws {
        let wda = NativeServicesWDA(screen: CGSize(width: 401, height: 801))
        let source: JSON = [
            "type": "pointer",
            "parameters": ["pointerType": "touch"],
            "actions": [
                ["type": "pointerMove", "duration": 0, "x": 100.25, "y": 200.25],
                ["type": "pointerDown", "button": 0],
                ["type": "pause", "duration": 30],
                ["type": "pointerMove", "duration": 45, "x": 101.75, "y": 201.75],
                ["type": "pointerUp", "button": 0],
            ],
        ]

        let points = try wda.finger(source)

        XCTAssertEqual(points.count, 3)
        XCTAssertEqual(points[0]["x"] as? Int, 16_424)
        XCTAssertEqual(points[0]["y"] as? Int, 16_404)
        XCTAssertEqual(points[0]["time_ms"] as? Double, 0)
        XCTAssertEqual(points[1]["x"] as? Int, 16_424)
        XCTAssertEqual(points[1]["time_ms"] as? Double, 30)
        XCTAssertEqual(points[2]["x"] as? Int, 16_671)
        XCTAssertEqual(points[2]["y"] as? Int, 16_527)
        XCTAssertEqual(points[2]["time_ms"] as? Double, 75)
    }
}
