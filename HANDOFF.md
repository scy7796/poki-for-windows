# poki/ios-integration handoff

`poki/ios-integration` is the one shared base for the standalone iPhone edition. It replaces
`dev/ios-standalone`, which stays as it is and is not deleted.

**How we work on it from now on**

- Both sides keep developing on this branch.
- Small changes can be pushed to it directly. Larger changes go on a short branch and come back as a
  pull request into `poki/ios-integration`.
- Pull before you push. Never force-push.

**The default is one app.** Only Poki is installed. Poki automates the iPhone in its own process
(the in-process session, through testmanagerd), with no Poki Runner and nothing listening on a port.
Poki Runner is optional: a build with `--with-runner` in our packaging, and `-automationPath runner`
at launch or the switch in Settings > Diagnostics, which takes effect when Poki starts again.

## How the branch was built

Its base is `origin/dev/ios-standalone` at cdebb5d, Zhehan's latest head. The branch was built on
f8c4429, and cdebb5d's commits came in with merge 11d3ee3. Our branches are merged in dependency
order, one merge commit per branch.

| Merge commit | Source branch | Source head | Notes |
|---|---|---|---|
| e05c657 | fix/esp-168-setup-entry | bd1ea68 | The private beta packaging (Ad Hoc export options, the beta build's signing team and bundle ids) was removed from every commit before the merge, so it is not in this branch's history. |
| 2d454e8 | feat/esp-162-island | 78f4c6f | |
| e3f5d95 | fix/esp-175-inprocess-apps | ce3ec11 | Includes ESP-173 up to 807807a. |
| c9c3945 | feat/esp-174-chat and feat/esp-177-pi-ios | c7e696c, 1d1299b | The first chat commits (7b25384, 2fcd645, ce621da) were squashed into one commit before the merge. |
| 6ad912c | feat/esp-176-return | 9d36314 | |
| f966a11 | fix/esp-173-inprocess-snapshot | b481314 | Its one Debug probe commit that fix/esp-175 did not carry. |
| 718e28e | fix/esp-183-any-https-redirect | 44985f9 | Reviewed. |
| 11d3ee3 | dev/ios-standalone | cdebb5d | Zhehan's new head. Computer.swift keeps both sides: the re-read after a launch and the timing line come first, then ESP-176's finish. |
| 79ec23b | fix/esp-184-reconnect-approval | d58ad45 | Reviewed twice. Its commits were rebuilt on this branch's 9f4e2c5 without the beta packaging. cdebb5d's action caps move into its `actionCap`. |
| a48d241 | fix/esp-160-type-log | 3a40072 | Reviewed three times. Rebuilt on 34d9013. See the known issue on the field read after a failed type. |
| 9f2ce73 | feat/esp-152-single-app | 32876cc | Reviewed twice. Rebuilt without the beta packaging; its one commit that only touched that packaging is left out. |

The branch also carries 28 commits from `origin/main` (up to 452f4bb) that our branches were based on.
They are already public.

Our line has its own copy of the iOS history before 0.2.3 (from 0200384 on), next to the copy in
`dev/ios-standalone`. Both copies hold the same work; the first merge (e05c657) takes 0.2.3 (ebdfdc8)
as the common base so they meet without conflicts.

Commit messages on this branch are in English. Commits that came from our branches have new ids
here, because their messages were translated or because an ancestor changed. The full map is at the
end of this file.

Heads taken from branches that are still being worked on. Later commits come in on this branch.

| Branch | Head taken | In this branch |
|---|---|---|
| feat/esp-174-chat | c7e696c | yes (squashed) |
| feat/esp-177-pi-ios | 1d1299b | yes |
| feat/esp-176-return | 9d36314 | yes |
| fix/esp-173-inprocess-snapshot | b481314 | yes |
| fix/esp-184-reconnect-approval | d58ad45 | yes |
| fix/esp-160-type-log | 3a40072 | yes |
| feat/esp-152-single-app | 32876cc | yes |
| dev/ios-standalone | cdebb5d | yes |
| feat/esp-156-voice | ebfbd0d | no: voice now runs look and do inside the app, so the Mac bridge's extra type_text tool is not needed |

fix/esp-184, fix/esp-160 and feat/esp-152 were based on our old line (24e0dae or bd1ea68). Their
commits were rebuilt on this branch's copies of those commits before they were merged. Any other
branch based on the old line needs the same, or the beta packaging and the unsquashed chat commits
would return to the history.

## What is in the branch

Commit ids are this branch's.

| Feature | Commits |
|---|---|
| App screens rebuilt in the website's design language (blue page, glass cards, Geist), with Simplified Chinese through String Catalogs | ef5dafb, b19422e, b96ef8e, 394cc11, 9b15032 |
| Setup is one tap away from every screen; its main button has its own bar; the loopback step leads with the proxy app | 34dccdb, 0700ff1 |
| Built-in local connection for using the iPhone on its own, Karing support, on-device pairing kept alive while Settings is open | 13c00f5, b8e0a3e, 0b32a63, 3c2b22a |
| Cellular-only hint: when iOS refuses the loopback on cellular, the status says to connect to Wi-Fi first | 79b9e46 |
| Live Activity and Dynamic Island redrawn from the final boards, with shorter words and Chinese | aa80221, 71c2962, 27e8f36, 239ae38, c84d973 |
| Zhehan's hand-off card ("Your turn", "Done, carry on") and tap shield, kept and redrawn in the new Live Activity | c26ca33, resolved in e05c657 |
| Voice: talk to Poki over the OpenAI Realtime API (WebRTC); look and do run in the app's own PokiCore | c26f614, 1f035b0, 294206a, 1f93e60, 9f4e2c5, 34d9013 |
| Voice and `do` never tap inside Poki, so only the owner approves | 154bd2d, e95c02c, adbecd4, ae8b942 |
| Relay registration accepts any https callback (Grok Bot, Poke, Meta AI); plain http only for localhost; `REDIRECT_HOSTS` is an optional restriction | e58b23a, ce036d4, a5d2713, a6dbf96 |
| In-process automation: Poki reads trees, taps, types and opens, switches and ends apps from its own process through testmanagerd, without Poki Runner; the switch and probes are in Settings > Diagnostics | 0cd4010 to 33bbe66, 64f64b2 |
| Chat page (iMessage style), Poki's details page, model settings and the voice page, a swipe apart | 7f463fa |
| The chat's model loop is pi (PiSwift, MIT), with Anthropic, OpenAI, DeepSeek, Gemini and ChatGPT login; the direct Anthropic and OpenAI clients stay behind `-chatEngine direct` | a3a92a1, 5fe6e41, 410180a, ff7eadb, b408feb |
| When a task ends, the phone goes back to the app it began in (`do` with `finish: true`, a client ending its session, the chat's turn ending, or the app's idle stop) | 8140268, 6922c04, a9cfb4b, 938c534, e53f4fc, 021c8f8 |
| Zhehan's cdebb5d: a launch reads until the launched app is in front, `wait_until` gets the time it asks for, and a long call says where its time went; with a test for a launch and a finish in one `do` | cdebb5d, 11d3ee3 |
| `do` waits up to 115 s for the owner's approval (less behind a relay that gives up sooner) and runs in the same call once approved; the relay's request timeout is 180 s; the Live Activity's buttons do not open the app | 94b7899, c649804, 3b96a41, 2daf5c0, 4a415fd |
| The built-in local connection reconnects with backoff after a failure or drop, unless the owner turned it off or another VPN is up (best effort) | f065911, 60b6d1d, 3f6a752, 7d94a88, 3c8e767, 17b7ca0, 457b733 |
| A type that fails or times out is checked against the focused field before anything is sent again; the log keeps the failed step's error line without the typed text | 723abc1, 643bab2, 8dadf80, 76565b7, 53cc7af, 45fb12c, 7dae05a |
| One app by default: the in-process session opens ahead of the first look, a session that fails to open answers at once and is tried again, the clipboard works in-process, and the runner's setup step and rows are hidden; the docs and the deployment skill install only Poki | 0329391, 4c26db5, 64a2f38, 66c1efa, 56287f2, 1b3c2e7, 291b107, ae6f5c8, b684bc8, dec76d6, c18e2aa, fd1a7fb, 9f2ce73 |
| The hand-off card's content line is a fixed short line per kind; the chat keeps its setup bubble while a setup step is left; Poki 0.2.7 | 5defb45, 897517b, 49bdac9, 2f5695b |

## Verified on a real iPhone

- Poki 0.2.3: the runner, launcher, PokiCore and Live Activity fixes came from three rounds of phone
  tests.
- Beta builds 0.2.4 and 0.2.6: Poki and Poki Runner installed from the beta install page and opened.
  Setup reached the pairing step, which needs the owner's passcode.
- Through the relay, Grok Bot typed English and Chinese into the Settings search field (0.2.6).
- Voice page on 0.2.6: it opened with the bridge address filled in, and Talk to Poki could be tapped.
  A spoken turn on the phone heard nothing: it connected to OpenAI, with no transcript. 34d9013 is the
  likely fix; it is not confirmed on the phone.
- In-process path: the tap and type probes ran on the phone. A crash on accessibility notifications
  was found there and fixed (33bbe66). The typed text's read-back differed from what was sent.
- Single app (feat/esp-152, its own build before 32876cc, not this merged build): with only Poki
  installed, the first look read the screen in about 1.5 s with the session already open, Home went
  to the Home Screen, and Chinese text read back as typed.
- Taps from the Mac were dropped while the phone's `AssistiveTouchEnabledByiTunes` was true; short
  taps worked again once it was false.

## Seen only on the simulator

- The new app screens, in English and Chinese.
- The redrawn Live Activity in all its states, including the hand-off card.
- The cellular-only hint (forced with `-pokiLoopback cellular`).
- In-process read, tap, type and read-back in the fixture app, and opening, switching and ending apps.
- The chat page with pi: one full task with Gemini (Settings > General > About, read the iOS version),
  with the plan steps ticked; OpenAI through both loops, three runs each.
- Going back to the app a task began in: from Safari, work in Settings, then back to Safari.
- Voice: 20 of 20 synthesized spoken requests answered correctly through the Mac bridge (median 2.0 s
  from the end of speech to the spoken answer); 5 of 5 silent test runs in the app.

## Known issues

- The relay has no default address any more; each person enters their own relay in Settings.
- The in-process path's tree has not been compared with Poki Runner's on the phone, and its typed
  read-back differed on the phone.
- ChatGPT login: the callback into the app's own 127.0.0.1:1455 has not been tried on a phone.
- Anthropic, OpenAI and DeepSeek keys have not been tried through pi; only Gemini has.
- The hand-off card uses the approval colour rather than its own.
- The app tests in PokiTests (Zhehan's `AppModelTests` and ESP-152's in-process tests) compile on
  this branch but were not run here (`native/ios-app/scripts/app-tests.sh`).
- After a failed type, the field is read through WDA's `GET /element/active` (fix/esp-160).
  `dev/ios-standalone` stopped using that query for the focus wait before typing, because it hung the
  CI simulator's runner for 19 s; the focus wait still uses tree reads. The read after a failure has
  its own 3 s limit. Whether to move it to tree reads too is still to decide.
- The in-process session's `placeholderValue` answer (7dae05a) has not been tried on a phone.
- When the owner cancels the passcode prompt for the in-process session, the prompt can come back
  within a moment instead of at the next call.
- The runner path can only be chosen at launch from the Mac (`-automationPath runner`) or with the
  switch in Diagnostics; the release notes do not say so yet.
- `native/ios-app/Poki/Native/InProcess.m` warns about an undeclared selector
  (`requestSnapshotForElement:attributes:parameters:error:`); the build succeeds.
- The approval wait and the reconnect need a phone: an approval that takes about 45 s through the
  relay, a reconnect after a failure, and no reconnect after the connection is turned off in Settings.

## What we do next

- Decide whether releases still carry Poki Runner, now that one app is the default.
- Chat entry and pi: acceptance on a real iPhone, with real keys and the ChatGPT login.
- Voice with a real person speaking into the phone's microphone.

## Suggested next steps for Zhehan

<!-- Left for the maintainer to fill in. -->

## Build and test results on this branch

| Check | Result |
|---|---|
| App, simulator build (Poki and PokiExternal) | BUILD SUCCEEDED for both (generic iOS Simulator, arm64) |
| PokiCore tests | 164 tests, 0 failures |
| deploy/cf-relay tests | 12 tests, 0 failures |

## Commit id map

<details>
<summary>Source branch commits and their ids on this branch</summary>

Several source ids on one row are either the first chat commits, squashed into one, or commits that
only touched the beta packaging, which were dropped; their ids map to the commit that took their place.

| Source branch commit | Integration branch commit | Message | Subject on this branch |
|---|---|---|---|
| 6163a6e | 3b29802 | translated | PokiCore: test typed text that holds a closing quote |
| 6c15da4 | 531fab1 | translated | PokiCore: straight quotes inside the typed text of a label |
| 4384f2c | 4342feb | unchanged | Merge land/ios-1-relay-core into land/ios-2-launcher-runner |
| f36fdcc | 5d8abe6 | unchanged | iOS: Poki 0.2.3 runner and launcher fixes from three rounds of phone tests |
| e779e3a | 1d2cc0c | unchanged | Runner: document that port 8100 is open to the local network |
| 2b811af | a8814da | unchanged | Merge land/ios-2-launcher-runner into land/ios-3-app |
| 9c22ec5 | 3e26c75 | unchanged | iOS: Poki 0.2.3 app and Live Activity fixes from three rounds of phone tests |
| d8a6b39 | 9ec3d7d | unchanged | App: drop typed text from multi-step steps in the log |
| 6d6fd8b | 7af6e92 | unchanged | App: say in the README that port 8100 is open to the local network |
| e581355 | 13c00f5 | unchanged | Add a built-in local connection for standalone iPhone use |
| 9ac8295 | d982aa5 | unchanged | Clarify local connection section references |
| a9fc6a4 | fcae8ee | unchanged | Resolve signing templates against the built app group |
| 9631358 | da5df2f | unchanged | Spell out the loopback section reference in the release checklist |
| 28cd813 | b8e0a3e | unchanged | Support Karing without replacing its VPN |
| e017752 | 0b32a63 | unchanged | Keep on-device pairing alive while Settings is open |
| 8562d70 | d9fd3fd | unchanged | Document standalone iPhone setup and Codex cloud workflow |
| 3b1aba8 | d5b4452 | unchanged | App: say in the README which build a paid team and a free Apple ID sign |
| a0896a8 | ab2bb63 | unchanged | Skill: a placeholder for the relay's Worker name, and the account note |
| b0ae0f1 | 7521246 | unchanged | App: tell the agent how to bring back the built-in connection |
| 1f741a9 | 3c2b22a | unchanged | Pairing on the phone: stop waiting after 10 minutes |
| 59ace52 | 9a49006 | unchanged | Proxy modules: say that the built-in connection takes the VPN slot |
| 55dc852 | f3b7670 | unchanged | Device checklist: the upgrade from 0.2.3 with a proxy app |
| ad4fb2c | ac1cbc0 | unchanged | Skill: a license line and no team-internal workflow words |
| c747312 | dd724c5 | unchanged | App: the pairing keep-alive no longer silences the session's |
| a880bac | 9edd3b2 | unchanged | iOS packaging: check the built version instead of writing it |
| 59248d3 | dae92c2 | unchanged | App: the external build drops a saved built-in choice |
| 62f8782, 7328303, c6d9fd6, fec238e | 6b6e546 | unchanged | Setup: one name for "the connection cannot change now" |
| 6f429af | c84d973 | translated | Live Activity: Geist font, and the licenses of three source projects |
| 7349b00 | aa80221 | translated | Live Activity: Dynamic Island and Lock Screen redrawn from the ESP-139 final boards |
| 90b7e2f | 71c2962 | translated | Live Activity: colours match the final tokens; the preview's heights follow measurements |
| b42088f | 27e8f36 | translated | Live Activity: remove leftover state and repeated code |
| 705e975 | 1f0dc9e | translated | Merge the redrawn Live Activity into the beta source, for recording approvals on a real iPhone |
| ebf2b5d | 239ae38 | translated | Live Activity: shorter words on the Dynamic Island and the Lock Screen, with Simplified Chinese |
| e519788 | ef5dafb | unchanged | iOS: rebuild the app screens from the ESP-139 final boards |
| 0ae3f3c | b96ef8e | unchanged | iOS: localize the loopback words, keep sample data off a real phone |
| bb6a72b | b19422e | unchanged | iOS: localize the app's screens with String Catalogs, white status bar |
| cb60f50 | 394cc11 | unchanged | iOS: show PokiCore's step labels in the system language on Home |
| 5bab642 | 9b15032 | translated | iOS: use iOS's own Chinese word for "tap" everywhere |
| f59d9f3 | d181e97 | translated | Merge the beta source fec238e into the ESP-168 screens (5bab642), for 0.2.5 |
| dee8e9a | 0700ff1 | unchanged | iOS: setup's main button gets its own bar instead of covering the list |
| d0282df | 34dccdb | unchanged | iOS: setup is always one tap from Home; loopback step leads with the proxy app |
| 3fdea6a | e13c797 | translated | Merge feat/esp-156-voice (real-time voice) into the beta line, the base of 0.2.6 |
| b00f4b8 | 79b9e46 | translated | iOS: with only cellular and the loopback refused, ask to connect to Wi-Fi before turning Poki on |
| af1231b | 1f93e60 | translated | Voice acts on the phone itself: look and do run in the app's own PokiCore |
| 24e0dae | 9f4e2c5 | translated | Voice: the -pokiVoiceBridge launch argument sets the voice bridge address, in beta builds too |
| bd1ea68 | 34d9013 | translated | Voice: release the background silent audio and set a voice-chat session before the microphone opens; log whether the microphone hears anything |
| 110dd4a | e05c657 | translated | Merge fix/esp-168-setup-entry: the standalone iPhone line, into the integration branch |
| 2137647 | e58b23a | translated | Relay: allow Grok Bot's OAuth callback host www.cursor.com by default |
| 78f4c6f | ce036d4 | translated | Relay: allow Poke's OAuth callback host poke.com by default |
| 0474ee1 | 2d454e8 | translated | Merge feat/esp-162-island: the relay allows Grok Bot's and Poke's OAuth callbacks |
| a3a1490 | 0cd4010 | unchanged | App: tap and type from Poki's own process, a Debug probe |
| c7ace46 | cfd29e4 | unchanged | App: the probe checks whether the screen can be read in-process |
| 4ee8a4c | 60f51ce | unchanged | App: the read probe finds the front app through the process tracker |
| 4ac3c6a | ae856c4 | unchanged | Launcher: an in-process mode that only mounts the disk image |
| a020560 | 2fc35f3 | unchanged | App: PokiCore's requests answered in Poki's own process, behind a switch |
| e7ef099 | e091ffe | unchanged | App: the later probe can find the front app's field and read it back |
| 11ebac8 | 81f94a6 | unchanged | App: the in-process path stands by without ending its session, and needs no runner step |
| 9d1b46f | 56bec11 | unchanged | App: the in-process path is the default, and its session opens when Poki is ready |
| bd3a181 | 12bb272 | unchanged | App: the in-process path reads other apps' element trees without XCUIApplication |
| 5066e21 | 917f071 | unchanged | Simulator check: in-process read, tap, type and read-back in the fixture app |
| 807807a | 2aa83f7 | unchanged | Debug: a probe that keeps the front app's tree from both paths |
| ac251bd | b44d66b | unchanged | App: the in-process path opens, switches and ends apps through testmanagerd |
| 458200c | 9ff3e13 | unchanged | Simulator check: --apps launches, switches, relaunches and ends the fixture app |
| 334c365 | f169f09 | unchanged | Debug: the later probe records whether the focused field was found and if the text was appended |
| 08358c6 | 8bb99af | unchanged | Debug: a probe that opens, switches and closes an app through the in-process path |
| ce3ec11 | 33bbe66 | unchanged | App: ignore AX notifications in the in-process path, whose handler throws outside a UI test |
| 23f75e6 | e3f5d95 | translated | Merge fix/esp-175-inprocess-apps: in-process reading, typing and opening, switching and ending apps |
| 7f33685 | 7585d71 | translated | Merge feat/esp-156-voice (real-time voice) into the chat entry branch |
| 7b25384, 2fcd645, ce621da | 7f463fa | squashed | iOS: chat page, Poki's details page, model settings and voice page (ESP-174, first version) |
| cd60d51 | d16d0bb | translated | Merge the voice branch's change: do checks an element's identifier against the approval words too (ae8b942) |
| ffeb3b3 | 539d4f7 | translated | Chat: use the Mac Poki Agent's prompt and its plan and finish tools |
| ae6f9f5 | a3a92a1 | translated | Chat: OpenAI, defaulting to GPT-6.1 Sol with low reasoning |
| c7e696c | 5fe6e41 | translated | Chat: OpenAI's default model is GPT-6.1 Terra, still with low reasoning |
| 228bf3b | 410180a | translated | Chat: the pi loop (PiSwift), with DeepSeek, Gemini and ChatGPT login |
| acb3188 | ff7eadb | translated | Chat: the log records each task's loop, time, tool calls and result |
| 1d1299b | b408feb | translated | Chat: the pi loop is the default; the direct Anthropic and OpenAI clients need -chatEngine direct |
| 97925e8 | c9c3945 | translated | Merge the iPhone chat page and the pi loop (feat/esp-174-chat, squashed, with feat/esp-177-pi-ios) |
| c5bec58 | 4bba3ba | unchanged | iOS: setup's main button gets its own bar instead of covering the list |
| c7456f1 | 8078da2 | translated | PokiCore: failing tests for going back to the app a task began in (ESP-176) |
| 7bcd0b1 | 8140268 | translated | PokiCore: when a task ends, the phone goes back to the app it began in (ESP-176) |
| 22ecc9f | 938c534 | translated | PokiCore: the simulator check and docs state the rules for going back to the app a task began in (ESP-176) |
| 556b8b9 | 6922c04 | translated | PokiCore: going back to the app a task began in waits until it is really in front (ESP-176) |
| 876214e | a9cfb4b | translated | Docs: going back to the app a task began in waits until it is in front (ESP-176) |
| 9d36314 | e53f4fc | translated | PokiCore: the task ends when the runner stops, so a later session delete does not wake it (ESP-176) |
| dcfcb40 | 6ad912c | unchanged | Merge feat/esp-176-return: the phone goes back to the app a task began in |
| b481314 | 64f64b2 | unchanged | Debug: the two-path tree probe logs the front app before each read and reads in-process again last |
| fc330fe | f966a11 | unchanged | Merge fix/esp-173-inprocess-snapshot: the two-path tree probe logs the front app |
| 38438da | a5d2713 | translated | Relay: failing test for registration accepting any https callback (ESP-183) |
| 44985f9 | a6dbf96 | translated | Relay: registration accepts any https callback; REDIRECT_HOSTS becomes an optional restriction (ESP-183) |

Later merges (fix/esp-184, feat/esp-152, fix/esp-160):

| Source branch commit | Integration branch commit | Message | Subject on this branch |
|---|---|---|---|
| 114f2d8 | 94b7899 | translated | PokiCore: failing tests for the approval wait (the default wait is shorter than a person's approval, and the wait outlasts the relay's limit) |
| b788c23 | c649804 | translated | PokiCore: do keeps waiting while the approval card is up, and the same call runs once approved |
| 33848b5 | 3b96a41 | translated | Live Activity: Allow, Deny and Stop state that they do not open the app |
| d2c8b38 | f065911 | translated | PokiCore: failing tests for the built-in local connection's reconnect rules |
| 63299c8 | 60b6d1d | translated | iOS: the built-in local connection reconnects after it fails or drops |
| c445bf1 | 3f6a752 | translated | iOS: failing test, no reconnect when the tunnel stopped because the owner turned it off or another VPN took over |
| 01e8fa1 | 7d94a88 | translated | iOS: no reconnect when the built-in connection is turned off in Settings or taken over by another VPN |
| d9457a3 | 2daf5c0 | translated | PokiCore: failing tests, no actions run when the approval arrives in the relay's last seconds or after the call was cancelled |
| 4d0b20a | 4a415fd | translated | PokiCore: an approval in the relay's last seconds leaves the actions for the next call, and a cancelled call no longer runs them once approved |
| 3f2bbdc | 3c8e767 | translated | iOS: failing test for checking whether another VPN is already up before reconnecting |
| 27d20f3 | 17b7ca0 | translated | iOS: coming to the front no longer starts the built-in connection; a reconnect stops and says so when another VPN is up |
| d58ad45 | 457b733 | translated | Docs: the local connection's reconnect is best effort |
| b9bce37 | 501870a | translated | Merge the in-process session (ESP-152, ESP-173, ESP-175) into fix/esp-168-setup-entry |
| 9bc0000 | 0329391 | translated | App: the in-process accessibility notification stub no longer retains its number argument; Home sends a device event |
| 9d9894b | 4c26db5 | translated | App: the in-process session answers PokiCore's clipboard read and write |
| 883e355 | 64a2f38 | translated | App: the in-process path hides the runner's setup steps and status rows; a PokiCore end-to-end probe |
| dacdee9 | none | dropped | It only touched the beta packaging. |
| 2c82b25 | 66c1efa | translated | App: on the in-process path the setup guide says Poki, not Poki Runner |
| 104385e | 56287f2 | translated | App: the in-process session opens ahead of time, so an agent's first look does not wait for it |
| 6b1c109 | 1b3c2e7 | translated | App: a PokiTests app test target, and a failing test for an unreadable clipboard answered as empty |
| f9ac84d | 291b107 | translated | App: the in-process session reports an unreadable clipboard as an error instead of empty |
| a301d82 | ae6f5c8 | translated | App: failing test, an agent hears at once why the session did not open, and a retry starts |
| 0c7ed64 | b684bc8 | translated | App: when the in-process session fails to open, the agent hears why at once, and the next call tries again |
| 9360bf6 | dec76d6 | translated | App: the automation path is read once per launch; the in-process Debug section without callers is removed |
| efe1667 | c18e2aa | translated | Docs: the docs and the deployment skill install only Poki by default; the runner is optional |
| 32876cc | fd1a7fb | translated | App: on the in-process path the home screen no longer says the runner starts when an agent asks |
| 97cdd8b | 723abc1 | translated | PokiCore: failing tests, a failed type logs its error line and reads the field before trying again |
| 69ea8eb | 643bab2 | translated | PokiCore: a failed step's error line goes to the log; a type that fails or times out reads the focused field before trying again |
| f9e8ff2 | 8dadf80 | translated | App: the log records a failed step's error line |
| 36a6714 | 76565b7 | translated | PokiCore: a failed type's log line gives the state, not the field's content; an empty field's placeholder counts as empty; the tool description follows |
| eea33a6 | 53cc7af | translated | PokiCore: failing tests for type recovery when the field reads its placeholder, the placeholder starts the text, or the placeholder cannot be read |
| 3a40072 | 45fb12c | translated | PokiCore: a field reading its placeholder counts as typed, a placeholder that starts the text is not typed again, and an unreadable placeholder is said so |

</details>
