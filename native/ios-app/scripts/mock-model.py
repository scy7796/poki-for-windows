#!/usr/bin/env python3
"""A scripted OpenAI-compatible model for the on-device agent's end-to-end check (ios-agent-chat.yml).

Poki's chat is pointed at http://127.0.0.1:8765/v1 as a custom endpoint. Each conversation follows the
same script, by how many tool results it already carries:

  0  report_plan   1  do (open Settings)   2  look   3  finish_task   4+  a plain answer

so the real pi loop in the app runs real look and do calls on the simulator. Every request is summed up
in a JSON line (roles, tool names, whether a screenshot came back) for the workflow to check.

    python3 mock-model.py --port 8765 --log requests.jsonl
"""
import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCRIPT = [
    ("report_plan", {"steps": ["Open Settings", "Read the screen"], "currentStep": 1, "title": "Look at Settings"}),
    ("do", {"actions": [{"launch": "com.apple.Preferences"}]}),
    ("look", {}),
    ("finish_task", {"success": True, "summary": "Settings is open on the iPhone.",
                     "details": [{"label": "App", "value": "Settings"}], "answer": {"kind": "action"}}),
]
ANSWER = "Done: Settings is open on the iPhone, and I can see its list."


def summary(body):
    messages = body.get("messages", [])
    tool_results = [m for m in messages if m.get("role") == "tool"]
    pictures = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, list):
            pictures += sum(1 for part in content if isinstance(part, dict) and part.get("type") in ("image_url", "input_image"))
    return {
        "at": time.time(),
        "model": body.get("model"),
        "stream": bool(body.get("stream")),
        "roles": [m.get("role") for m in messages],
        "tools": sorted(t.get("function", {}).get("name", "") for t in body.get("tools", [])),
        "tool_results": len(tool_results),
        "pictures": pictures,
    }


class Handler(BaseHTTPRequestHandler):
    log_path = "requests.jsonl"

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            self.reply_json({"object": "list", "data": [{"id": "poki-mock", "object": "model"}]})
        else:
            self.reply_json({"ok": True})

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        line = summary(body)
        with open(self.log_path, "a") as f:
            f.write(json.dumps(line) + "\n")
        step = line["tool_results"]
        model = body.get("model") or "poki-mock"
        if step < len(SCRIPT):
            name, arguments = SCRIPT[step]
            call = {"index": 0, "id": f"call_{int(time.time() * 1000)}_{step}", "type": "function",
                    "function": {"name": name, "arguments": json.dumps(arguments)}}
            message, finish = {"role": "assistant", "content": None, "tool_calls": [call]}, "tool_calls"
        else:
            message, finish = {"role": "assistant", "content": ANSWER}, "stop"
        usage = {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}
        if body.get("stream"):
            self.stream(model, message, finish, usage)
        else:
            self.reply_json({"id": "chatcmpl-mock", "object": "chat.completion", "created": int(time.time()), "model": model,
                             "choices": [{"index": 0, "message": message, "finish_reason": finish}], "usage": usage})

    def stream(self, model, message, finish, usage):
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.end_headers()
        base = {"id": "chatcmpl-mock", "object": "chat.completion.chunk", "created": int(time.time()), "model": model}

        def send(chunk):
            self.wfile.write(b"data: " + json.dumps({**base, **chunk}).encode() + b"\n\n")
            self.wfile.flush()

        delta = {"role": "assistant"}
        if message.get("tool_calls"):
            delta["tool_calls"] = message["tool_calls"]
        else:
            delta["content"] = message["content"]
        send({"choices": [{"index": 0, "delta": delta, "finish_reason": None}]})
        send({"choices": [{"index": 0, "delta": {}, "finish_reason": finish}]})
        send({"choices": [], "usage": usage})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def reply_json(self, value):
        data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--log", default="requests.jsonl")
    args = parser.parse_args()
    Handler.log_path = args.log
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
