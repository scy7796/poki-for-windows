# Configuration and sessions

All device operations are serialized inside the daemon, unless `POKI_INPUT_LOCK=1` gives each session its own queue. Every setting below is optional:

| Setting | Purpose |
| --- | --- |
| `POKI_MCP_STATE_DIR` | Override the state and endpoint directory. Must be set to the same value for both daemon and client. |
| `POKI_MCP_SESSION` | Session identifier (`1–80` characters: letters, digits, `_`, or `-`). Simultaneously connected clients with the same identifier share a session and its device selection, while distinct identifiers isolate them. The session closes as soon as any sharing client exits. Because of this, a shared value will not preserve a selection across separate `bin/call.mjs` runs, and reusing a running client's identifier in `bin/call.mjs` will clear that client's selection when the command exits. |
| `POKI_MCP_DEVICE` | Default device id or name for every session that has not selected one, for example when a physical iPhone and a booted simulator are both available. Set it in the daemon's environment. A `device` argument or `select_device` still takes precedence. |
| `POKI_MCP_APPROVAL_MODE=allow` | Preapprove sensitive operations (listed under [Approval & Clipboard Behavior](tools.md#approval--clipboard-behavior)) for this daemon instance. Omit for interactive local approval prompts. |
| `POKI_MCP_TASK_APPROVAL=1` | Require per-task approval in the stdio client (`bin/poki-mcp`). It adds `begin_task` and `end_task`, and refuses every device tool except `list_devices` and `poki_mcp_status` until `begin_task` raises an MCP elicitation that the person accepts. One acceptance covers the task until `end_task`, an idle limit, or a total limit, whichever comes first. A client without elicitation support cannot start a task, so the gate fails closed. An answer that arrives after `end_task` or after a newer `begin_task` is ignored. This is separate from `POKI_MCP_APPROVAL_MODE`, which covers individual sensitive operations on the daemon. |
| `POKI_MCP_TASK_IDLE_MINUTES`, `POKI_MCP_TASK_MAX_MINUTES` | Idle and total limits of an approved task. Default to 10 and 60. |
| `POKI_MCP_TASK_APPROVAL_TIMEOUT_MINUTES` | How long `begin_task` waits for an answer. Defaults to 9. |
| `POKI_MCP_TASK_APPROVAL_CLIENT` | Name shown at the start of the approval prompt. Defaults to `An MCP client`. |
| `POKI_MCP_NATIVE_TRACE` | Enable native diagnostic timing output on `stderr`. |
| `POKI_BIND_HOST` | Addresses the local HTTP bridge listens on, comma-separated. Defaults to `127.0.0.1`; `127.0.0.1` is added to any list that has no `127.0.0.1` or wildcard entry, because local clients read a `127.0.0.1` endpoint from `mcp.json` and send that `Host` header. A wildcard address cannot be combined with others. |
| `POKI_HOST_ALLOW` | Comma-separated `Host` header allowlist, for example `127.0.0.1,192.168.1.20`. When set, `hostHeaderValidation(list)` replaces `localhostHostValidation()`, which otherwise rejects every non-loopback `Host` with `403` and makes a LAN bind unusable. It must contain `127.0.0.1` itself: an entry for `localhost` or `[::1]` does not match the `Host` header local clients send. |
| `POKI_MCP_TOKEN` | Fixed bearer token for the local HTTP bridge. Defaults to a random token generated at each start, which invalidates every client's configuration on restart. |
| `IDEVICE_TOOLS` | Optional path override for the pinned upstream CLI. |
| `POKI_INPUT_LOCK=1` | For a daemon shared by several MCP clients: each session keeps its own order, read-only tools run beside other sessions' work, and input takes a lock on its device. See [One daemon, several clients](tools.md#one-daemon-several-clients). |
| `POKI_INPUT_LOCK_WAIT_MS` | How long a call waits for a device another session is driving before it fails and names the holder. Default 30000. |
| `POKI_MAX_CONCURRENT_READS` | How many read-only calls run at once with `POKI_INPUT_LOCK=1`. Default 4. |
| `POKI_MCP_CALL_LOG` | Path of a log with one JSON line per tool call: tool, duration, verdict and whether it failed, never arguments, text or images. |

The authenticated local HTTP bridge passes the session via the `x-poki-mcp-session` header. Standard MCP clients should always connect through `src/stdio.mjs`.

On loopback the token file is a local convenience rather than a remote access mechanism: nothing off the machine can reach the bridge. That changes as soon as `POKI_BIND_HOST` points at something else, because the bearer token then becomes the only thing between the network and full control of the device. Give it to a LAN or tailnet you trust, keep it in a mode-0600 file rather than a command line, and expect `403` from every client whose `Host` header is not in `POKI_HOST_ALLOW`.

`poki_mcp_status` reports the version from the root `package.json`, the current short Git `commit` (`unknown` outside Git), and `native_build`, the bridge file’s UTC modification time (`unknown` when absent). A daemon startup warning reports Rust source or Cargo metadata newer than the bridge. It does not block startup or rebuild anything.
