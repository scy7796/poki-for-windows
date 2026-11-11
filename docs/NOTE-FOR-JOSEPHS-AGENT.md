# Note for Joseph's agent: Poki on the iPhone, standalone (branch `dev/ios-standalone`)

Written Nov 7 2026, 1:30 am ET, updated 1:10 pm ET, for Joseph and the agent working for him. Zhehan is away and cannot
test further builds, so everything from this round is on this branch. It was developed on Zhehan's
fork (ZhehanZhang/poki-remote) and consolidated here; nothing on `main` was changed and no PR is open.
The companion branch `dev/mcp-agent-tools` carries the matching work on the Node MCP; its note is
`docs/mcp-agent-tools-notes.md` there.

## Ground rules for this branch

- Do not merge into `main` without Joseph's review (CODEOWNERS). Open a PR only when Joseph asks.
- CI here never runs on a push: every workflow in `.github/workflows/` is `workflow_dispatch` only
  (GitHub shows "Run workflow" only once a workflow file is on the default branch), and `release.yml`
  runs on an `ios-vX.Y.Z` tag, so it never collides with Poki's own `vX.Y.Z` releases.
- Checks you can run without a phone:
  - PokiCore: `cd native/ios/PokiCore && swift test` (Linux or macOS; 93 tests plus a soak).
  - PokiLauncher: clone `jkcoxson/idevice` at `89702099f4d7552f704f93b4526756abda319ceb` into
    `.deps/idevice`, apply `native/patches/idevice-xctest-run-over-rsd.patch`, then
    `cd native/launcher && cargo test`.
  - Relay: `cd deploy/cf-relay && npm ci && npx vitest run`.
  - App: `native/ios-app/scripts/make-assets.sh && xcodegen generate --spec native/ios-app/project.yml`,
    then build the `Poki` scheme (see `.github/workflows/ios-app.yml` for the exact unsigned build and
    the simulator screenshots, plus the app's unit tests against a fake launcher).
  - Poki Gym: `xcodegen generate --spec native/ios-gym/project.yml`, build `PokiGym` for the
    simulator (`.github/workflows/ios-gym.yml`).
- Evidence rule used so far: a claim about the phone counts only when it was seen on a real device;
  simulator-only facts are listed in `native/ios/PokiCore/UNVERIFIED.md`.

## What this is

Poki running with no Mac and no server in the loop. The iPhone runs three pieces of ours:

- **Poki** (`native/ios-app`): SwiftUI app. Setup, on/off, Live Activity with Allow/Deny for
  sensitive actions, the MCP address for each client, a Debug tab with the log.
- **Poki Runner** (`native/ios-runner`): WebDriverAgent 16.15.3 as an XCTest runner, branded,
  plus `PokiRunnerHost` (an injected dylib) that draws its screen. Started by Poki through
  `PokiLauncher` (Rust, idevice, `native/launcher`) over the phone's own developer services at
  10.7.0.1, which the user's proxy app reflects back (Surge, Loon, Shadowrocket, sing-box modules in
  `deploy/proxy-modules`). No VPN slot taken, no Mac after the first pairing.
- **PokiCore** (`native/ios/PokiCore`, Swift): the MCP (`look`, `do`, `status`) over WDA at
  127.0.0.1:8100, reached from the cloud through a Cloudflare Worker relay (`deploy/cf-relay`,
  live at pokimcp.zheha.nz, stores nothing).

The model stays in the cloud (claude.ai, Claude Code) and talks to the phone through the relay.

## What is on this branch

All of it is new files under these paths, except a WebDriverAgent section in `THIRD_PARTY_NOTICES.md`:

| Path | What | Fork branch it came from (final commit) |
|---|---|---|
| `native/ios-app` | The app (0.2.5, build 61), including the Live Activity | `dev/ios-app` f0bf5e7, `dev/live-activity` 8654a1d |
| `native/ios/PokiCore` | The on-phone MCP (`look`, `do`, `status`); its own note is `native/ios/PokiCore/NOTE-FOR-UPSTREAM.md` | `dev/ios-core` fe77fd1 |
| `native/launcher` | PokiLauncher (Rust, idevice): pairs, mounts the DDI, starts and supervises the runner | `dev/ios-core` 65f7595 |
| `native/ios-runner` | WDA 16.15.3 submodule, branding, `PokiRunnerHost` | `dev/ios-runner` a3e80ea |
| `deploy/cf-relay`, `native/ios/RelayCheck` | Workers relay and a client check | `dev/cf-relay` fb8876c |
| `native/ios-gym` | Poki Gym: a simulator app with one screen per hard case for UI automation (animation that never idles, alerts, the paste prompt, long lists, sheets, late focus, dense and duplicated trees, a web view, a navigation stack), so look/do scenarios have a fixed target; `ios-gym.yml` builds it and its scorecard job runs PokiCore from the same branch through ten hard screens and three faults (all pass) | `dev/ios-gym` aa0dd36 |
| `docs/research-ax-tree-reliability.md` | What bounds accessibility tree reads under animation, and the options | `dev/ios-app` |
| `deploy/proxy-modules` | Loopback modules for Surge, Loon, sing-box, Shadowrocket | `dev/ios-app` |
| `docs/ios-core.md`, `docs/device-test-checklist.md`, `docs/production-bar.md`, `docs/release-review.md`, `CHANGELOG.md` | Spec, phone checklist, release notes | |

Tags: none yet. Versions come from `native/ios-app/VERSION`; `release.yml` on an `ios-vX.Y.Z` tag
builds both IPAs with that version. The relay address is still hard-coded to Zhehan's deployment
(`pokimcp.zheha.nz`, in `PokiCore/Core.swift` and `ios-app/Poki/Connect/RelayIdentity.swift`); that
needs a decision before anything ships from this repo.

## Phone-test rounds on an iPhone 17 Pro, iOS 27.3 (owner's own tests)

| Round | Build | Found | Fixed in |
|---|---|---|---|
| 5 | 0.2.0 | Live Activity clipped; scrolling stalled; approvals never showed (event stream died after the first Turn off); Stop slow; raw JSON | 0.2.1 |
| 6 | 0.2.1 | Taps near the top landed on the expanded Dynamic Island and opened Poki; iOS 27 container clipped the Live Activity; "Best Buy" read as a payment | 0.2.2 |
| 7 | 0.2.2 | Surge's tunnel dropped twice and took the runner with it (recovery 30-90 s); tree reads stalled behind autoplay and a paste alert; one WDA session per read; paste leaked the clipboard; stale element numbers | 0.2.3 (tunnel side) and PokiCore e822e43 (clipboard, banner, sessions, relay drop); the rest is open |
| 8 (unattended, simulator only) | 0.2.3 | Twelve Poki Gym runs: a wedged app held the runner; busy answers had no picture; a timed-out tree read failed the call; scroll_to answered unknown; container taps said nothing | 0.2.4: watchdog restart, picture from outside the runner, in-call re-read, scroll_to progress, hand-off card. Needs the phone: hand-off card, island taps, JD/WeChat again, passcode card |
| 9 (unattended, simulator only) | 0.2.4 | Six more gym runs on Settings, Contacts, Safari, Photos, an alert mid-scroll and an app relaunch: rows flicked past unread; a launch read the old app's tree; Go key not tapped; alerts over a launched app unexplained | 0.2.5: scroll_to drags and reads between drags, launch re-reads until the app is in front, keyboard's own Go key, one-line alerts, `took:` lines. Needs the phone: JD/WeChat feeds, Safari Go key, permission alert over a launch |

Details per round: `native/ios-app/CHANGELOG-round.md`. What only the phone can confirm:
`native/ios/PokiCore/UNVERIFIED.md`, `docs/device-test-checklist.md`.

## The owner's rules for this layer (Nov 7 2026)

1. The runner never crashes or wedges by itself, whatever the task or its length; only the owner's
   Stop or the agent withdrawing ends it, and it can always return up-to-date information.
2. The tree is readable at any moment, even under animation that never finishes, cheap on the
   device, and it matches the screenshot. The tree stays the primary source.
3. The MCP never stalls the agent. "The animation is not over, you cannot read the tree" is a
   forbidden answer: while the runner is up and a screenshot is possible, every call answers with the
   picture and something to act on. Success rate under hard conditions is the metric.
4. The first runner start after a restart may need the owner's passcode. It is detected and shown on
   the Live Activity, the agent reads a plain "starting" meanwhile, and the launcher waits up to 5 min.
5. Handing a step to the owner (a verification, a password, a payment) is the agent's call: it
   hands the screen over through the Live Activity ("Your turn" with a Done button), input pauses,
   reads keep working, and the agent keeps polling. The sensitive-action approvals stay as built.
6. All of it works both with the Poki agent in this repo and with a raw agent such as Claude
   connected straight to the MCP.

## What landed in 0.2.4 (Nov 7, simulator only, not yet on a phone)

- **Never-halt answers** (PokiCore): an answer that carries a read is never `isError` (an `error:`
  line says what went wrong); a busy runner answers `not_sent` with the picture; a starting runner
  says to call again; a refused runner says to call again in 10 s.
- **Hand-off channel**: `do` with `{handoff: {kind, text}}` raises `CoreEvent.handoffRequested`, the
  app shows "Your turn", input is held until `PokiCore.handoffDone(id:)` or `{handoff: false}`;
  every answer and `status` carry a `handoff:` line; `{wait_until: {handoff_done: true}}`.
- **Tree reads**: no WDA session needed (`/source` and `/wda/activeAppInfo` are sessionless); after a
  timed-out read the next asks for half the snapshot depth (min 12) and says so; `screen: moving`
  when the picture changed around a late tree. `POKI_AX_DEADLINE` sets the read deadline.
- **Fixes**: `clear: true` is checked; typing waits up to 2 s for focus; `{back: true}`; duplicates
  listed once; a tap on a container names the elements inside it; a fresh launch survives an app
  that takes over 4 s to end.
- **Wedged runner**: an app whose main loop hangs holds WDA's whole queue while `/status` still
  answers (found with the Gym); PokiCore restarts the runner itself after a 15 s stall and says so.
- **Launcher and app**: the passcode wait (`code passcode` after 12 s) becomes a "Your turn" card;
  tapping the Live Activity never opens Poki; iOS 27 corner margins; loopback watched in the
  background; app unit tests.

## Open problems, in order of pain

1. **Tunnel drops.** The XCTest runner dies when the developer connection does, and that connection
   runs through the user's proxy tunnel. 0.2.3 notices a drop, names it to the agent with the time
   and restarts the runner the moment 10.7.0.1 answers; it cannot stop the drop. Ideas: a keepalive
   through the tunnel, Surge on-demand rules, checking whether Focus/Bedtime suspends the proxy.
2. **Tree reads under animation.** WDA's snapshot waits for the app to idle; JD's homepage and a
   system paste alert never idle. PokiCore e822e43 keeps the session when a read times out and moves
   WDA's active-app detection point to mid-screen; the Nov 7 work reads without a session, backs off
   the snapshot depth and marks a moving screen. Alert detection before slow calls is still to do;
   `docs/research-ax-tree-reliability.md` lists the options.
3. **`via: "paste"`** inserted the owner's clipboard instead of the text once. Fixed in PokiCore
   e822e43 (write verified, clipboard restored only once the field shows the text), not yet seen on
   the phone.
4. **Element numbers** persist across page changes; the agent tapped the wrong thing by number.
5. **Stop while the runner is stuck** in a long read waits for iOS's ~30 s watchdog; 0.2.3 retries.

## How this could unify with upstream's MCP

- The detailed view from the PokiCore side is in `native/ios/PokiCore/NOTE-FOR-UPSTREAM.md`: one
  look/do contract for both MCPs, facts only, phone-only pieces stay in the app.
- `dev/mcp-agent-tools` (this repo) already carries a WDA backend for the look/do profile in the Node
  daemon (`src/cua-wda.mjs`, `POKI_CUA_BACKEND=wda`), so `look` and `do` answer the same way whether
  the bridge or the runner is underneath. PokiCore's later lessons (timed-out requests end the WDA
  session so nothing runs late, XML tree, busy answers, covered-element taps, the island region,
  per-action clocks) are in Swift and would need porting into that backend (about a day).
- The runner path sidesteps the private RemoteXPC services behind upstream issues #1 (AX and touch
  unavailable on iOS 18.6) and #6 (usbmuxd empty on macOS 27.2), and needs no Mac after pairing.
  It still needs the personalized developer disk image (#18 applies as much to us).
- It cannot replace all upstream tools: no raw HID, no per-process tools, and the runner must be
  installed and signed (a free Apple ID gives 7 days and 3 apps).
- Suggested shape: the runner path as an optional backend behind the same tool names, chosen per
  device, with the on-phone app as the way to run it without a computer.

## Facts that cost us time (so you do not pay again)

- ActivityKit `AlertConfiguration.sound` is not optional; an alert always expands the island, and a
  tap on the expanded island opens the app. Never alert while automation may tap near the top.
- A Live Activity on iOS 27's Lock Screen sits in a container with a ~40 pt corner radius; keep
  content within 124 pt and 22/18 pt margins.
- Cancelling the Task that iterates an `AsyncStream` ends the stream for good: one pump per app life.
- WDA serves one request at a time except `GET /status`, `GET /screenshot`, `DELETE /session`;
  `DELETE /session` voids everything queued, which is the only clean "abandon".
- The JSON `/source` fetches custom actions per element (one accessibility round trip each); the
  XML `/source` does not and is 3 to 7 times faster.
- A merge once dropped the CI version stamp silently; the IPA check in `ios-app.yml` now fails
  if the IPA's version differs from `VERSION`.
