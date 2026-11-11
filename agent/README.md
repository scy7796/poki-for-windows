# Run Poki Agent

Poki Agent accepts tasks from the terminal, one configured iMessage sender, or allowlisted Telegram users. It uses pi and the MCP server in this repository. Poki App is not required.

## Install

Use macOS, Node.js 24 or later, and the prerequisites in the [Poki MCP README](../README.md).

```sh
./bin/setup
npm ci --prefix agent
```

Run these commands from the repository root. `bin/setup` checks the required macOS tools, fetches the pinned idevice dependency, builds its command-line tools, installs the MCP dependencies and builds the native bridges. Running `npm run build:native` alone does not prepare idevice in a new checkout.

Start an MCP server in a separate terminal. Choose its state directory explicitly when you need an isolated instance.

```sh
export POKI_MCP_STATE_DIR="$PWD/agent/.runtime/mcp"
node src/daemon.mjs --port 0
```

Set the same `POKI_MCP_STATE_DIR` in the terminal that starts Poki Agent. The poki task command selects a single connected physical phone automatically. Use --device when multiple phones are connected or when targeting a simulator.

## Configure OpenAI access

Choose one access method. The agent uses pi's existing OpenAI providers and credential handling.

For ChatGPT, run `poki login` and choose ChatGPT. Existing OpenAI and legacy `openai-codex` OAuth credentials are reused. Add this checkout’s `bin` directory to PATH.

```sh
export PATH="$PWD/bin:$PATH"
poki login
poki status
```

The default is GPT-6.1 Terra (`gpt-6.1-terra`), low reasoning, with Fast requested. Select ChatGPT access:

```sh
export POKI_AGENT_AUTH=chatgpt
export POKI_AGENT_MODEL=gpt-6.1-terra
```

For API access, set the key in your environment. Never put it in the configuration file or a committed shell script.

```sh
export POKI_AGENT_AUTH=api-key
export OPENAI_API_KEY='<your API key>'
export POKI_AGENT_MODEL='<OpenAI API model>'
```

The defaults are `gpt-6.1-terra`, reasoning `low`, and Fast (`serviceTier: "priority"`, sent as `service_tier=priority`). Execution, result verification and route answers all use low reasoning, including `turn/start`; callers cannot raise it. Override the model with `POKI_AGENT_MODEL` or the channel configuration. To request standard service explicitly, use `POKI_AGENT_SERVICE_TIER=default`. The `priority` spelling is the supported Fast wire value. Omitted or undefined tier options retain this default.

A requested tier is not proof of the tier served. Each response records the actual outgoing effort, requested tier and raw `servedServiceTier`; request records retain rejected attempts. If Fast is rejected, that request retries once with explicit `default`; later requests retain Fast. A response reporting `default` produces a warning and keeps the configured tier for subsequent execution, verification and readout requests. Shared configuration is never downgraded. This warning stays in the terminal log even when iMessage suppresses progress messages. The current ChatGPT account returned `default` in local acceptance, including when Fast was requested; Fast has not been verified on that account.

For local protocol development, API-key mode accepts `OPENAI_BASE_URL` pointing to a loopback HTTP server. Other remote providers are not supported.

## Send a terminal task

Run from the repository root.

```sh
poki 'Open Settings and read the iOS version.'
```

The terminal shows progress and the final result. Enter `/stop` to stop or enter task corrections while it runs. The agent handles login, verification codes and system prompts with its tools. If it cannot complete the task, it reports the completed work, blocker and attempted approaches.

Each step has a 60-second deadline including model and tool time. Set `POKI_AGENT_STEP_TIMEOUT` or pass `--step-timeout <seconds>` to the CLI or a channel worker. Individual device tool calls are capped at 130 seconds by default, deliberately just above the daemon's own 120-second remote limit so that a slow link is reported by the daemon - which can say whether input may already have been delivered - instead of being cut off by the client with a bare timeout; `POKI_MCP_CALL_TIMEOUT_MS` overrides it. There is no whole-task deadline. A forward `report_plan.currentStep` or a changed screen fingerprint after a successful action resets the step clock, including pages without headings or a bundle ID. Scrolling, swiping, text-field edits without submission, same-page actions and repeated/backward step numbers do not. A pending model request is cancelled when the deadline expires. Task records include `metrics.steps` with page fingerprint, step, elapsed time and reset reason. Alert/dialog/sheet changes do not count as a new page. Tool errors are returned to the model while the step clock keeps running. Submitting a final answer suspends the step clock. A separate 45-second limit covers the final model response and independent verification. On verification timeout the candidate answer is retained and returned as unverified, never as confirmed success. Each attempt and its reason are retained in `execution.verifications`. Failed verification resumes the remaining step time and asks the model to continue collecting evidence; it does not grant a fresh deadline. Failure conclusions also undergo independent verification. Claims that an entry or content cannot be found require evidence of scrolling down the current page until content stops changing; scrolling up or reaching the bottom of another page does not suffice. An unsupported failure is returned for further search at most once. Failure review and further search keep the current step clock running. Evidence-backed capability or information blockers remain failures, not successes.

### Optional iPhone unlock

Ask after installing Poki Agent: **"Do you want Poki Agent to unlock this iPhone when it is locked?"** Stop for the answer. Ask even if phone pairing or device operations are skipped; asking does not operate the phone. Skip the question only after an explicit refusal. Default to no configuration. Declining leaves other features available. The user alone sets `POKI_IPHONE_PASSCODE` in a private local launcher environment. An installing agent must not read or write the passcode for the user. Keep it on this Mac, outside chat, model inputs, logs, shell history, and source control. Without configuration, the user unlocks the phone manually. Anyone or any program with access to this Mac may be able to read the passcode. Never ask the user to send it in chat.

If the user agrees, give them these commands to run themselves in a zsh terminal, from the repository root. Input is hidden. The exported value lasts for that shell and its child processes. Start Poki Agent from that same terminal. This adds no password storage.

```sh
export PATH="$PWD/bin:$PATH"
read -rs 'POKI_IPHONE_PASSCODE?iPhone passcode (hidden): '
printf '\n'
export POKI_IPHONE_PASSCODE
poki --device '<device UUID>' '<user task>'
unset POKI_IPHONE_PASSCODE
```

The installing agent provides these commands but does not run them or inspect the variable. If the daemon uses a custom `POKI_MCP_STATE_DIR`, the user must set that same path in this terminal.

When configured, Poki Agent can use its host-integrated `unlock_device` tool on a locked phone. The host passes the passcode to the helper over stdin, outside model context and tool arguments. The verified hardware case is only iPhone17,1 in portrait orientation with a six-digit passcode and a 402-by-874-point keypad. Other layouts are not verified. Inspect the resulting screen before claiming that the phone is unlocked.

`./bin/setup` and `npm run build:native` build the helper. Check it from the repository root:

```sh
test -x build/native-target/release/examples/unlock_iphone
```

The integrated [unlock skill](skills/iphone-unlock/SKILL.md) describes keypad checks and the earlier hardware verification. The host integration was tested with a fake helper. Installation verification does not repeat a real unlock.

### Task records

Task records and learned routes are stored under `agent/.runtime`. Use `--state` to select another private directory. A verified route navigates without model inference. Action tasks finish with zero model calls when their result conditions match. Fixed fields are read from the current screen using learned unique field selectors, also with zero model calls. Lists use learned section boundaries and row structure to extract current entries with zero model calls; if that structure no longer matches, one tool-free model response selects facts from the current screen. Missing or ambiguous evidence cannot complete the task. Previous answers are never replayed. A changed navigation page hands execution back to pi from the current screen. Routes older than version 5 must be learned again.

Use `--context 'Read only. Do not sign in or register.'` to supply initial restrictions without changing the task text. Routes match both the task and its exact initial context. Changing or omitting that context requires exploration again. Instructions entered while a task is running prevent that run from becoming a reusable route.

## Configure iMessage through BlueBubbles

Install and start [BlueBubbles Server](https://docs.bluebubbles.app/server/). In its settings, enable the local HTTP server and set a server password. On the same Mac, its default URL is `http://127.0.0.1:1234`. BlueBubbles owns Messages permissions. Poki Agent does not read the Messages database or run a native message helper.

Set the server URL and password in the worker's environment. Use HTTPS when the server is on another machine. Keep credentials out of configuration files, shell history, and source control. For example, read the password without displaying it in zsh:

```sh
export BLUEBUBBLES_URL=http://127.0.0.1:1234
read -rs 'BLUEBUBBLES_PASSWORD?BlueBubbles password: '
export BLUEBUBBLES_PASSWORD
```

Create `~/.config/poki-agent/imessage.json` as a private JSON file. Set `sender` to the exact iMessage phone number, including country code, or email address. Use one direct sender. Create the parent directory first with `mkdir -p ~/.config/poki-agent`.

```json
{
  "sender": "allowed@example.test",
  "device": "<device UUID>",
  "model": "<model available to your account>",
  "auth": "chatgpt"
}
```

Restrict its permissions. Check authentication and the scoped read before starting the worker from the repository root:

```sh
chmod 600 ~/.config/poki-agent/imessage.json
poki imessage --config ~/.config/poki-agent/imessage.json --check
poki imessage --config ~/.config/poki-agent/imessage.json
```

`--check` sends no replies and starts no phone task. The first start records existing message IDs and skips history. It queries only the configured direct chat and sender, excludes outgoing messages and reactions, and never lists all conversations. Messages arriving after this baseline become tasks.

For a self-chat, set `chatGuid` in the private configuration to the exact direct GUID reported by BlueBubbles for that sender. Both `iMessage;-;<sender>` and `any;-;<sender>` are supported. Without `chatGuid`, the worker uses `iMessage;-;<sender>`. Verify this value with a query restricted to the intended conversation before starting. A self-chat must produce a received copy with `isFromMe=false`; the sent copy remains excluded.

To avoid duplicate bubbles, sign in to Messages on the Mac with a different Apple Account from the one on your iPhone, and message that account from your phone. If both use the same Apple Account, Messages shows every message twice, once sent and once received. This is how iMessage handles a self-chat, and Poki cannot hide either copy. Tasks are still processed once, and ordinary text messaging does not require disabling SIP.

Replies are plain text, with no visible prefix or invisible marker. Before each send, the worker records the exact text in a private reply ledger scoped to the server and direct chat. Each entry suppresses one matching received copy and expires after 24 hours if unused. A consumed entry stays tied to its received message ID until the cursor acknowledges it, so restarting before acknowledgement cannot turn that copy into a task. After consumption, a user can send identical text as a new task. The former bridge's `🤖 Codex：` replies are still ignored.

The ledger survives restart and uses file mode 600. Keep it with the channel cursor. A definite HTTP client rejection removes the entry; an uncertain send keeps it until consumption or expiry. If identical user text arrives before the synchronized reply, content-only matching treats the first copy as the reply. Set `context` in the private configuration to pass initial task context to every task. Stop the former bridge before starting Poki Agent so only one backend handles the chat.

Each iMessage task immediately sends a local confirmation based on the user's own words, before constructing the phone task or making a model request. Model text is not sent as a second opening. The confirmation goes through the same persistent reply ledger as every reply. The worker stays running and polls iMessage every 200 ms plus request time; Telegram keeps its existing polling and progress editing. The `opening-sent` log records receive-to-send duration without message contents. Task records separately measure model setup, MCP setup/status and model request timing.

After the confirmation, iMessage sends no intermediate progress or status prefixes. Send `/stop` to stop a task. Other messages while a task runs become task corrections, and Poki replies once to each to say so and to point to `/stop`. Otherwise the next reply is the final result. The cursor is saved before dispatch, so interrupted tasks are not replayed after restart. A failed or uncertain reply stops the worker without an automatic resend. Check the chat before restarting.

The default private state directory is `agent/.runtime/bluebubbles`. Use `--state <directory>` to change it. Keep one worker per channel configuration. The old SQLite cursor and `--fake-db`/`--outbox` flags are not used.

For an isolated MCP and worker lifecycle, run `node agent/scripts/self-chat.mjs --config <private JSON file> --state <private directory>` from the repository root. Add `--check` for a read-only startup check. The supervisor records device-call notifications from this worker. Stopping an idle worker closes its services without acquiring or cleaning up a device. Physical-device runs must still use the shared device lock.

## Telegram

Local protocol checks pass. A real bot receipt and delivery run has not been verified for this release.

### Configure a development bot

Create a bot with Telegram's official BotFather and obtain its token. Use a dedicated bot for this worker. Telegram allows only one polling consumer per bot. If the bot has an active webhook, remove it explicitly before starting. The worker reports the conflict and does not change webhook settings.

Read the token into the worker's environment without displaying it in zsh:

```sh
read -rs 'TELEGRAM_BOT_TOKEN?Telegram bot token: '
export TELEGRAM_BOT_TOKEN
```

Create `~/.config/poki-agent/telegram.json`. Use numeric Telegram user IDs, not usernames or phone numbers. Add only users who may control the configured device. The list must not be empty.

```json
{
  "allowedUsers": [123456789],
  "device": "<device UUID>",
  "model": "<model available to your account>",
  "auth": "chatgpt"
}
```

Start from the repository root:

```sh
chmod 600 ~/.config/poki-agent/telegram.json
poki telegram --config ~/.config/poki-agent/telegram.json --check
poki telegram --config ~/.config/poki-agent/telegram.json
```

The check verifies the bot identity and webhook status without fetching, acknowledging, or sending messages. On the first worker start, pending history is skipped. After `telegram: ready` appears, open a private chat with the bot and send a plain-text task. A separate bot conversation and task state is kept for each allowed user. Group chats, channel posts, bots, and all other users are ignored before task dispatch. They receive no reply. The same `accept`, `done`, `skipped` and `/stop` controls apply as for iMessage.

The worker uses the [official Telegram Bot API](https://core.telegram.org/bots/api) with long polling. Ordinary progress updates edit the current task's status message. Final results use separate messages. Plain-text replies longer than 4096 UTF-16 units are split at newline or space boundaries where possible, without breaking emoji surrogate pairs. No Markdown parsing is enabled.

A task result can carry the screenshot it ended on: add `"photos": true` to the Telegram configuration and the frame is uploaded through `sendPhoto`, as the caption when the reply fits in 1024 characters and as a separate photo otherwise. It is off by default because it puts the phone's screen into the chat on every task, and the key only applies to Telegram. At most one upload is attempted per reply. The reply falls back to text only when Telegram answered and refused the photo: a body that says `ok: false`, or a 4xx without one, such as a proxy's 413. A timeout, a connection that was reset, a 5xx from the gateway, or a response whose body could not be read is treated as possibly delivered, logged, and not resent, because the same words would then arrive twice.

Delivery retries are bounded to two retries after the first attempt. Explicit rate limits honor `retry_after` up to 30 seconds, and transient failures use exponential backoff. A longer rate limit stops the worker for a later restart. A timeout or interrupted connection after a send may mean delivery succeeded; that send is not automatically repeated. If a split reply partly succeeds, only the failing chunk is retried. Already delivered chunks are not sent again. Check the conversation before manually retrying a failed task.

The default state directory is `agent/.runtime/telegram`, with task files under each user's numeric ID. `--state` overrides the directory. Offsets are saved before dispatch, so an interrupted task is not automatically replayed. Keep the state directory between restarts. Run one worker per bot. Both channels use the same task interface and existing device coordination; authorize device use before running either worker.

For local protocol development only, `TELEGRAM_API_URL` may point to a loopback HTTP service. Other remote endpoints are rejected. The default is `https://api.telegram.org`. Keep the token in the environment; do not put it in a URL, configuration file, or evidence report.

## Test the message transport locally

`test/fixtures/messages.mjs` serves a synthetic BlueBubbles HTTP API on a random loopback port. It uses no personal Messages data and sends no real messages. The channel checks exercise sender isolation, pagination, restart, long replies, bounded retries and progress editing. The CLI checks run the real worker, task state machine, pi SDK and MCP stdio bridge against synthetic local model and device services:

```sh
node --test agent/test/messages.test.mjs agent/test/telegram.test.mjs agent/test/channels.test.mjs
```

The existing simulator acceptance script uses this HTTP fixture and a real dedicated simulator. Do not run it against a physical device. Provider protocol checks also use a local fake HTTP service and synthetic keys.

## Validation boundary

Real iMessage and Telegram receipt and delivery, and physical iPhone operation, need a separate authorized run. Fake transport results do not prove either. The local acceptance evidence distinguishes those paths. Source revisions and future synchronization points are in [SOURCES.md](SOURCES.md).

## Startup checks and app lookup

Before a channel announces readiness, it checks that `idevice-tools` exists and is executable at `IDEVICE_TOOLS` or `.deps/idevice/target/release/idevice-tools`. The self-chat supervisor also checks the native bridge and OCR executable. Missing tools produce an installation instruction instead of ready; run `./bin/setup` in the actual checkout. If the tool disappears later, the task reports that the phone tools need setup. These checks inspect files and do not operate a phone.

The agent's `list_apps` requires a name or bundle query and returns at most ten matching names and bundle identifiers. Large app metadata and the full directory are never forwarded to the model or verification trace. Call app lookup separately, outside `batch_commands`. When a target name is known, prefer `launch_app` by name. The underlying MCP tool API is unchanged.

Each phone tool call has a 130-second default deadline, above the daemon's 120-second remote limit (see `POKI_MCP_CALL_TIMEOUT_MS`). A timeout cancels the request; an in-flight action may already have run, so inspect its result before retrying. The separate step deadline counts cumulative model and tool time on the same page.

## License

Poki Agent is part of Poki and uses the [AGPL-3.0-only license](../LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
