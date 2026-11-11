import UIKit
import XCTest
@testable import Poki

/// PokiCore's paste backup saves the owner's clipboard first and puts it back afterwards; it pastes
/// nothing when the clipboard cannot be read. In-process the clipboard is Poki's own to read, and an
/// unreadable one answered as empty would be "put back" as empty: the owner's clipboard is gone.
final class InProcessClipboardTests: XCTestCase {
    private let wda = InProcessWDA(screen: CGSize(width: 402, height: 874))

    private func readClipboard() async throws -> (status: Int, text: String?) {
        let answer = try await wda.send(method: "POST", url: URL(string: "http://in-process/wda/getPasteboard")!,
                                        body: Data(#"{"contentType":"plaintext"}"#.utf8), timeout: 2)
        let value = (try JSONSerialization.jsonObject(with: answer.body) as? [String: Any])?["value"]
        let text = (value as? String).flatMap { Data(base64Encoded: $0) }.map { String(decoding: $0, as: UTF8.self) }
        return (answer.status, text)
    }

    func testAClipboardHoldingNoTextIsRefusedNotReadAsEmpty() async throws {
        let picture = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).image { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        }
        await MainActor.run { UIPasteboard.general.image = picture }
        let read = try await readClipboard()
        XCTAssertNotEqual(read.status, 200, "an image on the clipboard was answered as the text \(read.text.debugDescription)")
        let kept = await MainActor.run { UIPasteboard.general.hasImages }
        XCTAssertTrue(kept, "reading must leave the owner's clipboard as it was")
    }

    func testTextOnTheClipboardIsReadBack() async throws {
        await MainActor.run { UIPasteboard.general.string = "owner's 剪贴板 text" }
        let read = try await readClipboard()
        XCTAssertEqual(read.status, 200)
        XCTAssertEqual(read.text, "owner's 剪贴板 text")
    }
}
