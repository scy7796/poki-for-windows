import Foundation
import PiSwiftAgent
import PiSwiftAI
import PokiCore

/// The chat's model loop: pi's agent loop (PiSwiftAgent from xibbon/PiSwift, MIT, a Swift port of
/// pi-mono's pi-agent-core) with the providers of PiSwiftAI, on this iPhone. The prompt and the tools
/// are the chat's `Harness` (the Mac Poki Agent's); each tool call goes back to `ChatModel.perform`, so
/// look, do and status run through PokiCore with its approval rules and report_plan and finish_task
/// drive the plan bubble as before.
///
/// One loop holds one conversation, on one provider and model. Another model starts a new loop that
/// carries the messages over; pi converts them between providers.
@MainActor
final class PiLoop {
    enum Outcome: Equatable { case done, stopped, overTurns, failed(String) }

    let provider: ModelProvider
    let model: Model
    private let agent: Agent
    private let gate = StopGate()

    var signature: String { "pi:\(provider.rawValue)/\(model.id)" }
    var messages: [AgentMessage] { agent.state.messages }

    init(provider: ModelProvider, model: Model, tools: [ToolSpec], carrying messages: [AgentMessage] = [],
         sessionID: String = UUID().uuidString.lowercased(),
         perform: @escaping @MainActor (ToolCall) async -> PokiCore.ToolAnswer) {
        self.provider = provider
        self.model = model
        let gate = self.gate
        let agentTools = tools.map { spec in
            AgentTool(label: spec.name, name: spec.name, description: spec.description, parameters: spec.schema.mapValues { AnyCodable($0) }) { id, params, _, _ in
                if gate.stopped { return Self.result(PokiCore.ToolAnswer(text: "Task stopped. Action not executed.", jpeg: nil, isError: true)) }
                let arguments = (try? JSONEncoder().encode(params)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
                return Self.result(await perform(ToolCall(id: id, name: spec.name, arguments: arguments)))
            }
        }
        // agent/pi-session.mjs: low thinking, one tool call at a time.
        agent = Agent(AgentOptions(
            initialState: AgentState(model: model, thinkingLevel: .low, tools: agentTools, messages: messages),
            // Stable Go session affinity for all model and tool-continuation requests.
            sessionId: provider == .opencodeGo ? sessionID : nil,
            identity: provider == .opencodeGo
                ? ClientIdentity(userAgent: .custom("poki-ios/0.2.8"),
                                 attribution: .value(ClientAttribution(name: "Poki", url: "https://github.com/JosssphZhou/poki")))
                : nil,
            getApiKey: { _ in await ModelCredential.apiKey(for: provider) },
            // Go's Anthropic and Gemini adapters also require Console Bearer auth.
            // Resolve the key for EACH request so credential changes never leave stale headers.
            getModelAuth: { model in
                guard provider == .opencodeGo else { return nil }
                guard let key = await ModelCredential.apiKey(for: provider) else {
                    return AgentModelAuth(error: "OpenCode Go API key is missing.")
                }
                return Self.openCodeGoAuth(model: model, apiKey: key)
            },
            toolExecution: .sequential
        ))
    }

    /// Authentication is resolved on every turn via AgentModelAuth. PiSwift's Anthropic
    /// adapter uses x-api-key unless a Bearer header is supplied; Console needs Bearer.
    /// The Google adapter still appends its SDK query parameter, but also needs Bearer.
    nonisolated static func openCodeGoAuth(model: Model, apiKey: String) -> AgentModelAuth {
        let headers: ProviderHeaders?
        switch model.api {
        case .anthropicMessages, .googleGenerativeAI:
            headers = ["Authorization": "Bearer \(apiKey)"]
        default:
            headers = nil // OpenAI adapters already send Authorization: Bearer.
        }
        return AgentModelAuth(apiKey: apiKey, headers: headers)
    }

    /// The owner's message under this task's instructions, then pi's loop until the model answers
    /// without tools, `stop()` or `maxTurns` model turns. `onText` gets each finished text block.
    func run(_ text: String, instructions: String, maxTurns: Int, onText: @escaping @MainActor (String) -> Void) async -> Outcome {
        gate.reset()
        use(instructions)
        let turns = Counter()
        let failure = Box()
        let agent = self.agent
        let gate = self.gate
        let unsubscribe = agent.subscribe { event, _ in
            switch event {
            case .turnStart:
                if turns.increment() > maxTurns { gate.overTurns(); agent.abort() }
            case .messageEnd(.assistant(let reply)):
                if reply.stopReason == .error { failure.set(reply.errorMessage ?? "") }
                let texts = reply.content.compactMap { block -> String? in
                    guard case .text(let content) = block else { return nil }
                    let text = content.text.trimmingCharacters(in: .whitespacesAndNewlines)
                    return text.isEmpty ? nil : text
                }
                if !texts.isEmpty { await MainActor.run { texts.forEach(onText) } }
            default: break
            }
        }
        defer { unsubscribe() }
        do {
            try await agent.prompt(text)
        } catch {
            failure.set(error.localizedDescription)
        }
        if gate.stopped { return gate.wasOverTurns ? .overTurns : .stopped }
        if let message = failure.value {
            // The owner's message goes again with the next one, as with the direct clients.
            _ = agent.dropTrailingErroredAssistant()
            return .failed(Self.words(message, provider: provider))
        }
        return .done
    }

    /// Ends the task after the step under way: nothing more is sent to the phone or the model.
    func stop() {
        gate.stop()
        agent.abort()
    }

    /// The leading system message holds the instructions and declares the tools. pi keeps it when a loop
    /// carries messages over, so each task puts its own text in it and leaves the tools as they are.
    private func use(_ instructions: String) {
        var messages = agent.messages
        if case .system(var system)? = messages.first {
            system.content = .text(instructions)
            messages[0] = .system(system)
        } else if let system = createInitialSystemMessage(instructions, nil) {
            messages.insert(.system(system), at: 0)
        }
        agent.messages = messages
    }

    private nonisolated static func result(_ answer: PokiCore.ToolAnswer) -> AgentToolResult {
        var content: [ContentBlock] = [.text(TextContent(text: answer.text))]
        if let jpeg = answer.jpeg { content.append(.image(ImageContent(data: jpeg.base64EncodedString(), mimeType: "image/jpeg"))) }
        return AgentToolResult(content: content, isError: answer.isError)
    }

    /// The provider's message for the owner. pi never puts the key in it; a sign-in that ran out says so.
    private static func words(_ message: String, provider: ModelProvider) -> String {
        if message.contains("No API key") || message.contains("missingApiKey") || message.isEmpty && !ModelKeys.hasKey(provider) {
            return provider.signsIn ? String(localized: "Sign in to ChatGPT again: tap my picture, then Model.")
                                    : String(localized: "Add your \(provider.name) key: tap my picture, then Model.")
        }
        return String(localized: "\(provider.name): \(message.isEmpty ? String(localized: "the request failed.") : message)")
    }
}

/// Set by stop() or the turn limit, read by the tools on pi's tasks.
private final class StopGate: @unchecked Sendable {
    private let lock = NSLock()
    private var stop_ = false, over = false
    func reset() { lock.withLock { stop_ = false; over = false } }
    func stop() { lock.withLock { stop_ = true } }
    func overTurns() { lock.withLock { stop_ = true; over = true } }
    var stopped: Bool { lock.withLock { stop_ } }
    var wasOverTurns: Bool { lock.withLock { over } }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var n = 0
    func increment() -> Int { lock.withLock { n += 1; return n } }
}

private final class Box: @unchecked Sendable {
    private let lock = NSLock()
    private var text: String?
    func set(_ value: String) { lock.withLock { if text == nil { text = value } } }
    var value: String? { lock.withLock { text } }
}
