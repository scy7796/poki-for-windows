import Foundation
import XCTest
import PiSwiftAI
@testable import Poki

/// Captures the REAL request built by the pinned PiSwift provider adapters.
/// A synthetic HTTP 400 ends the stream without network access or paid credentials.
private actor GoRequestRecorder: ProviderHTTPClient {
    private var captured: URLRequest?

    func send(_ request: URLRequest) async throws -> ProviderHTTPResponse {
        captured = request
        return ProviderHTTPResponse(statusCode: 400, body: Data(#"{"error":"offline fixture"}"#.utf8))
    }

    func lastRequest() -> URLRequest? { captured }
}

final class OpenCodeGoProviderTests: XCTestCase {
    private let fixtureKey = "fixture-go-key"
    private let fixtureSession = "ses_poki_test_001"

    func testProviderIdentityAndDefaults() {
        XCTAssertTrue(ModelProvider.allCases.contains(.opencodeGo))
        XCTAssertEqual(ModelProvider.opencodeGo.rawValue, "opencode-go")
        XCTAssertEqual(ModelProvider.opencodeGo.piProvider, "opencode-go")
        XCTAssertTrue(ModelProvider.opencodeGo.wired)
        XCTAssertFalse(ModelProvider.opencodeGo.signsIn)
        XCTAssertTrue(ModelCatalog.defaults(.opencodeGo).contains("deepseek-v4.1-flash"))
    }

    func testRoutesPreserveModelAPIs() throws {
        let cases: [(id: String, api: Api, base: String)] = [
            ("deepseek-v4.1-flash", .openAICompletions, "https://opencode.ai/inference/go/openai/v1"),
            ("gpt-5.6-luna", .openAIResponses, "https://opencode.ai/inference/go/openai/v1"),
            ("claude-haiku-5-5", .anthropicMessages, "https://opencode.ai/inference/go/anthropic"),
        ]
        for item in cases {
            let model = try XCTUnwrap(ModelProvider.opencodeGo.piModel(item.id), "Missing Go model \(item.id)")
            XCTAssertEqual(model.provider, "opencode-go", item.id)
            XCTAssertEqual(model.api, item.api, item.id)
            XCTAssertEqual(model.baseUrl, item.base, item.id)
        }
        XCTAssertNotNil(ModelProvider.opencodeGo.piModel("kimi-k3"))
        XCTAssertNil(ModelProvider.opencodeGo.piModel("no-such-go-model"))
    }

    func testAnthropicFinalRequestPathAndAuthAreCorrect() async throws {
        let model = try XCTUnwrap(ModelProvider.opencodeGo.piModel("claude-haiku-5-5"))
        let auth = PiLoop.openCodeGoAuth(model: model, apiKey: fixtureKey)
        XCTAssertEqual(auth.apiKey, fixtureKey)
        XCTAssertEqual(auth.headers?["Authorization"] ?? nil, "Bearer \(fixtureKey)")

        let recorder = GoRequestRecorder()
        _ = await streamAnthropic(
            model: model,
            context: normalizeContext(Context(messages: [.user(UserMessage(content: .text("Hello")))])),
            options: AnthropicOptions(
                apiKey: fixtureKey, httpClient: recorder, sessionId: fixtureSession,
                headers: auth.headers, maxRetries: 0
            )
        ).result()
        let captured = await recorder.lastRequest()
        let request = try XCTUnwrap(captured, "PiSwift did not build an Anthropic request")
        XCTAssertEqual(request.url?.absoluteString, "https://opencode.ai/inference/go/anthropic/v1/messages")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(fixtureKey)")
        XCTAssertNil(request.value(forHTTPHeaderField: "x-api-key"))
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-opencode-session"), fixtureSession)
    }

    func testChatCompletionsFinalRequestPathAndSession() async throws {
        let model = try XCTUnwrap(ModelProvider.opencodeGo.piModel("deepseek-v4.1-flash"))
        let recorder = GoRequestRecorder()
        _ = await streamOpenAICompletions(
            model: model,
            context: normalizeContext(Context(messages: [.user(UserMessage(content: .text("Hello")))])),
            options: OpenAICompletionsOptions(
                apiKey: fixtureKey, httpClient: recorder, sessionId: fixtureSession, maxRetries: 0
            )
        ).result()
        let captured = await recorder.lastRequest()
        let request = try XCTUnwrap(captured, "PiSwift did not build a Chat Completions request")
        XCTAssertEqual(request.url?.absoluteString, "https://opencode.ai/inference/go/openai/v1/chat/completions")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(fixtureKey)")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-opencode-session"), fixtureSession)
    }

    func testResponsesFinalRequestPathAndSession() async throws {
        let model = try XCTUnwrap(ModelProvider.opencodeGo.piModel("gpt-5.6-luna"))
        let recorder = GoRequestRecorder()
        _ = await streamOpenAIResponses(
            model: model,
            context: normalizeContext(Context(messages: [.user(UserMessage(content: .text("Hello")))])),
            options: OpenAIResponsesOptions(
                apiKey: fixtureKey, httpClient: recorder, sessionId: fixtureSession, maxRetries: 0
            )
        ).result()
        let captured = await recorder.lastRequest()
        let request = try XCTUnwrap(captured, "PiSwift did not build a Responses request")
        XCTAssertEqual(request.url?.absoluteString, "https://opencode.ai/inference/go/openai/v1/responses")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(fixtureKey)")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-opencode-session"), fixtureSession)
    }

    func testGeminiFinalRequestPathAndBearerHeader() async throws {
        // Not all pinned catalogs list Gemini under Go, so use a synthetic Go model
        // to exercise PiSwift's native Google transport without assuming catalog membership.
        let model = Model(
            id: "gemini-4-argon", name: "Gemini Go", api: .googleGenerativeAI,
            provider: "opencode-go", baseUrl: "https://opencode.ai/inference/go/google/v1beta",
            reasoning: false, input: [.text],
            cost: ModelCost(input: 0, output: 0, cacheRead: 0, cacheWrite: 0),
            contextWindow: 128_000, maxTokens: 2048
        )
        let auth = PiLoop.openCodeGoAuth(model: model, apiKey: fixtureKey)
        let recorder = GoRequestRecorder()
        _ = await streamGoogle(
            model: model,
            context: normalizeContext(Context(messages: [.user(UserMessage(content: .text("Hello")))])),
            options: GoogleOptions(
                apiKey: fixtureKey, httpClient: recorder, sessionId: fixtureSession,
                headers: auth.headers, maxRetries: 0
            )
        ).result()
        let captured = await recorder.lastRequest()
        let request = try XCTUnwrap(captured, "PiSwift did not build a Gemini request")
        XCTAssertEqual(request.url?.path, "/inference/go/google/v1beta/models/gemini-4-argon:streamGenerateContent")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(fixtureKey)")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-opencode-session"), fixtureSession)
    }
}
