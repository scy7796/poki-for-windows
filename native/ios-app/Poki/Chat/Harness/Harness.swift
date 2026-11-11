// The chat's prompt and tools are the Mac Poki Agent's, copied from this repository at main 729c77e:
// - agent-system.md is agent/prompts/system.md (the same text as agent/prompts/pi-app.md, which
//   agent/task-runner.mjs loads), except two sentences that named tools the app lacks: a locked phone
//   is the owner's to unlock and a password prompt is handed to them, and a purchase is a plain tap;
// - the instructions put PokiCore's own MCP instructions first, as task-runner.mjs puts the MCP server's
//   instructions first;
// - look, do and status are PokiCore's tools with their MCP descriptions;
// - report_plan and finish_task are task-runner.mjs's harness tools (#startModel), descriptions and
//   schemas unchanged.
// Not copied, because the app has none of their tools: agent/prompts/call-draft.md and
// agent/skills/iphone-unlock/SKILL.md, unlock_device and handle_alert.
import Foundation
import PokiCore

/// One tool as the model sees it, before a provider puts it in its own form.
struct ToolSpec {
    var name: String
    var description: String
    var schema: [String: Any]
}

enum Harness {
    static let system: String = {
        guard let url = Bundle.main.url(forResource: "agent-system", withExtension: "md"), let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return text
    }()

    static var instructions: String { [PokiCore.toolInstructions, system].joined(separator: "\n\n") }

    /// The instructions for a task: the above, then the saved notes and the routines that fit it.
    @MainActor static func instructions(for task: String) -> String {
        let brief = PokiCore.memoryBrief(for: task)
        var parts = [instructions]
        // Poki learns the owner's repeated tasks: a saved routine runs them in one call next time.
        parts.append("Before starting, check whether a saved routine covers this task (routines {action: \"list\"}) and run it with do {run: name} if so. When a task worked and was not a routine yet, save it with routines {action: \"save\", name, description} before finish_task, with a short name the owner would use, so it can be repeated next time.")
        // A model decides approvals from what the owner said. A refused step goes through once the
        // owner says yes to it, so the agent asks in words and tries again.
        if ApprovalClassifier.mode == .reply {
            parts.append("Approvals here are decided from what the owner said in this chat. When a step is refused (declined), do not tell the owner to tap anything: ask them in plain words whether they want that step done, naming the step, and if they say yes, send the same step again.")
        }
        if !brief.isEmpty { parts.append(brief) }
        return parts.joined(separator: "\n\n")
    }

    static let tools: [ToolSpec] = phoneTools + [reportPlan, finishTask]

    /// PokiCore's catalog: look, do and status.
    static let phoneTools: [ToolSpec] = {
        guard let data = PokiCore.toolCatalogJSON.data(using: .utf8), let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        return list.compactMap { tool in
            guard let name = tool["name"] as? String, let description = tool["description"] as? String, let schema = tool["inputSchema"] as? [String: Any] else { return nil }
            return ToolSpec(name: name, description: description, schema: schema)
        }
    }()

    private static func object(_ properties: [String: Any], _ required: [String]) -> [String: Any] {
        ["type": "object", "properties": properties, "required": required, "additionalProperties": false]
    }
    private static let string: [String: Any] = ["type": "string"]

    static let reportPlan = ToolSpec(
        name: "report_plan",
        description: "Publish a plan before phone actions. Update currentStep (1-based) on each step. title names the task.",
        schema: object(["steps": ["type": "array", "items": string, "minItems": 1, "maxItems": 8], "currentStep": ["type": "integer", "minimum": 1, "maximum": 8], "title": string], ["steps", "currentStep"]))

    static let finishTask = ToolSpec(
        name: "finish_task",
        description: "Finish after the last observation verifies the requested result. If unable to complete, set success=false and explain what was completed, what blocked completion and what was tried. details must contain the requested facts, not only a page title; every value must match a whole current label or value. Declare answer.kind: action for a performed change, field for fixed values, list for requested entries. Read tasks must never use action. For field, items select current refs and label/value; when a field is combined into a label such as \"Capacity,90%\", use prefix \"Capacity,\" and suffix \"%\" to preserve the field identity while reading a new value. For list, items select all requested current rows in order with their names/times; start_ref and end_ref identify unique section labels immediately before and after those rows. Omit section refs if no reliable boundaries exist. Never invent refs or use a heading as a requested value.",
        schema: object([
            "success": ["type": "boolean"], "summary": string,
            "details": ["type": "array", "items": object(["label": string, "value": string], ["label", "value"])],
            "answer": object([
                "kind": ["type": "string", "enum": ["action", "field", "list"]],
                "items": ["type": "array", "items": object(["ref": string, "field": ["type": "string", "enum": ["label", "value"]], "prefix": string, "suffix": string], ["ref", "field"])],
                "start_ref": string, "end_ref": string,
            ], ["kind"]),
        ], ["success", "summary", "details", "answer"]))

    /// task-runner.mjs's answers to its harness tools.
    static let planPublished = "Plan published. Continue."
    static let resultRecorded = "Result recorded. Explain it briefly to the user."
    static let invalidPlan = "Invalid model plan"
    static let invalidResult = "Invalid task result"
}
