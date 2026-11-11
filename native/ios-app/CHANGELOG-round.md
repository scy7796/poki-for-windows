# Poki iPhone app: changes per round

What changed in each round, and what still needs the phone. Newest first.

## Developer Mode only when the phone says so (2026-11-09, on standalone)

Changed:
- Poki says Developer Mode is off only when the phone says so. A listener, tunnel or RSD failure after pair-verify says Poki can't reach this iPhone and lists the checks in order: Setup › Loopback, Setup › Pairing, then Developer Mode; the Live Activity says Can’t Reach iPhone. A phone without cryptexd is asked for DeveloperModeStatus first. A runner that stops before it answers points to UI Automation and to trusting Poki Runner's developer (#69).
- The Loopback page's text for a local interface with no answer says to reconnect and check Wi-Fi, then to pair again, then to check Developer Mode.
- The app acts on the launcher's failure code, not on words in its message. `-pokiLoopback noanswer` shows that Loopback state on a simulator.

Needs the phone:
- Reading DeveloperModeStatus through the tunnel's lockdown service.
- Home and the Live Activity after a listener, tunnel or RSD failure, for example with the proxy app turned off mid-connection.

## Remote pairing that does not answer (2026-11-09, on standalone)

Changed:
- When the loopback takes the connection but the phone's remote pairing service does not answer, Poki no longer says to turn on Developer Mode. It points to Setup › Loopback, then to pairing again in Setup › Pairing with the loopback on; Home offers Open Setup and the Live Activity says Loopback or Pairing (#69).
- The Loopback page no longer shows only Working in that case: the loopback probe only connects, and a proxy app can take the connection even when it cannot reach the phone, so the page says the remote pairing service is not answering through it.
- That failure names the I/O error under "device socket io failed" and how long the connection was held, and the pairing check and the first runner failure log the loopback kind, the local VPN state, Wi-Fi and the network path.

Needs the phone:
- The failure in #69 itself: automation that stops after about 25 minutes idle with a proxy app carrying the loopback. Its cause is not known yet.

## From poki/ios-integration (2026-11-08, onto standalone)

Changed:
- In-process path: an open of the automation session that has not answered in 5 s is waiting on iOS's passcode prompt. The Live Activity shows Passcode for automation, Poki's home asks the owner, and the agent reads that only the owner can enter the iPhone passcode; when iOS gives up, the call fails with that reason (from #48).
- Live voice stops after its answer: 8 s with nobody speaking ends the conversation, lets go of the microphone and turns the orange dot off; speaking within the 8 s goes on in the same conversation, and one opened within 5 minutes of the last conversation with something said in it is told the last turns. In the background Poki stops listening, also while connecting, unless a step it was asked for is running or its answer is still to be said, and then ends once that is said (from #50, #51).
- Live voice does not wait for the server for ever: an answer, the end of speech or the end of the audio that does not come (say, an error that names no request) ends the conversation after 60 s without a server event, or 30 s after Poki went to the background. A running step is not cut off (from #52).

Needs the phone:
- The passcode card when Automation Mode comes back on more than 8 hours after the passcode was last entered.
- Live voice with a person speaking: the end 8 s after the answer, and the background stop.

## Round 10 (2026-11-07, on poki/ios-integration), version 0.2.8

Changed:
- In-process path: the automation session is closed after the idle time, from Stop and when Poki is turned off, so iOS's "Automation Running" banner shows only while an agent works, as on the runner path. The next agent request opens a new session (new generation; an action meant for the old one is refused). A restart PokiCore asks for closes and reopens the session instead of being ignored. `scripts/inprocess-sim/check.sh --cycle` checks close, refusal while closed, reopen, read, tap and type on a simulator, and CI runs all three check modes.
- The idle stop applies to the in-process path too (Settings > Stop When Idle For).
- Setup, loopback page: the chosen app's tag is live (Working while 10.7.0.1 answers, Not Answering while it does not, with a line saying what to do); Stash, Quantumult X and Clash Mi added as users report them (marked "as reported", with the lines to add); Egern left out for want of a documented setting.
- Setup, pairing page: on iOS 26 and earlier, where the phone cannot pair with itself, the page shows pairing from a computer (Poki Setup) and the ways to send the file; Start Pairing and Pair Again appear only on iOS 27 and later. A pairing file opened from AirDrop or Files, or sent by `poki://pairing?url=…&sha256=…` from Poki Setup, lands in Poki; `poki://setup?relay=…` sets the relay.
- The pairing file and the setup state are kept in the Keychain as well, so a reinstall or a re-sign by a sideloading tool does not send the owner through setup again.
- iPad is in the device family with every orientation, and CI screenshots home, setup and connect on an iPad Pro 11 simulator. Beside another app (the iPhone Duo's side-by-side apps, iPad windows) Poki's own process is never the front app; the driven app's part of the screen is the agent's screen: the tree's frames and the screenshot are relative to it and touches are moved back onto the screen (`PKInProcess.viewport`).

Needs the phone:
- That the banner goes within seconds of the idle stop, and that reopening asks for no passcode within the same boot.

## Integration (2026-11-08, poki/ios-integration), version 0.2.7

Our branches merged onto Zhehan's dev/ios-standalone (cdebb5d). 0.2.5 and 0.2.6 were our beta builds; this is the first version from the shared branch. By default only Poki is installed: it automates the iPhone in its own process, and Poki Runner is optional.

Changed:
- App screens in the website's design language, with Simplified Chinese; setup one tap away from every screen.
- Chat page with pi as the model loop (Anthropic, OpenAI, DeepSeek, Gemini, ChatGPT login), Poki's details page, model settings and the voice page.
- Built-in local connection for using the iPhone on its own; it reconnects with backoff after a failure or drop, unless the owner turned it off or another VPN is up.
- One app by default: Poki automates the iPhone in its own process through testmanagerd, without Poki Runner. The session opens ahead of the first look, a session that fails to open answers at once and is tried again, and the clipboard works in-process. The runner path stays behind the switch in Settings > Diagnostics.
- When a task ends (do with finish, a client ending its session, the chat's turn ending, or the idle stop), the phone goes back to the app the task began in.
- do waits up to 115 s for the owner's approval (less behind a relay that gives up sooner) and runs in the same call once approved; the Live Activity's Allow, Deny and Stop do not open the app.
- PokiCore from cdebb5d: a launch reads until the launched app is in front; wait_until gets the time it asks for; a long call says where its time went.
- The relay accepts any https callback; its default request timeout is 180 s.
- A type that fails or times out is checked against the focused field before anything is sent again; the log keeps the failed step's error line without the typed text.
- The hand-off card's content line is a fixed short line per kind; the agent's own note is in the alert and the issue row.
- The chat shows the setup bubble while a step is left after pairing.

Needs the phone:
- Chat with pi on real keys and the ChatGPT login; voice with a person speaking.
- The local connection's reconnect after a failure, and no reconnect after it is turned off in Settings.
- An approval that takes about 45 s, through the relay.
- The in-process path's tree compared with Poki Runner's; a failed type in a field with a placeholder on the in-process path.

## Round 9 (2026-11-07, unattended gym round continued, 9:00 am-12:00 pm ET), version 0.2.5

Changed:
- PokiCore (dev/ios-core 1ca12e5) after six more gym runs, now also on Settings, Contacts, Safari and Photos, an alert popping up mid-scroll and an app relaunch under wait_until: scroll_to drags (84 % of the area, no momentum) and reads between drags, so a row can no longer be flicked past unread; a launch re-reads inside the call until the launched app is in front (the tree was the old app's over the new app's picture); wait_until keeps the time it asks for; the keyboard's own Go/Search/Return key is tapped for {key: "return"}; a system alert over a launched app, an alert over a scrolled list, a field the app replaced after typing, and an app that is not installed are all said in one line; when no picture comes at all, the last picture is attached with its age; a long call ends with where its time went ("took: ...").
- Gym (dev/ios-gym d062708): interrupt scenario (alert mid-scroll), system apps, permission alerts answered, the runner waited for while it restarts.

Needs the phone:
- JD.com and WeChat feeds with scroll_to across calls; Safari address bar with the Go key; a permission alert over a launched app.

## Round 8 (2026-11-07, unattended gym round, 1:30-5:00 am ET), version 0.2.4

Changed:
- Live Activity: a tap on it never opens Poki (a no-op intent under every surface, no links); the island stays compact during steps.
- Hand-off: the agent can hand a screen to you (passcode, password, verification, payment, other) with its own words; the Live Activity shows "Your turn" with Done; inputs pause, reads go on, the agent keeps polling. The runner's own passcode prompt after a restart uses the same card (the launcher waits up to 5 min).
- PokiCore (dev/ios-core 37fe4d8) after twelve gym runs on the simulator: a wedged app no longer blocks the runner for good (15 s watchdog, restart, "this is the new runner" note); a picture from outside the runner when the runner gives none; busy answers carry the picture and are not errors; a timed-out tree is read again in the same call (fewer children, then shallower); scroll_to reports progress and continues on the next call, never "unknown", never swipes past an unread screen (a swipe moves at most 70 % of the area; an unread swipe is read first), and names the found element's number; taps on containers name the buttons inside; no more GET /element/active (the keyboard in the tree is the focus signal); web views say to read again while their parts load.
- App unit tests run on the simulator in CI (fake launcher: loopback drops, pairing, the agent's view of the runner, the passcode card).
- Poki Gym (native/ios-gym): ten hard screens and three faults scored per commit; all pass on 9e06c49.

Needs the phone:
- The hand-off card and Done on the Lock Screen and the island; a tap on the island that does not open Poki.
- JD.com / WeChat again: tree reads under their animations, scroll_to across long feeds, the watchdog's restart if an app wedges.
- The passcode card after a restart.

## Round 6 (2026-11-07, after the 10:32 pm ET Mail test), version 0.2.2

Changed:
- Poki stays out of the agent's way: no Dynamic Island pop-up per step, at start or on an app switch (approval, problem, pairing and finish only); the island area is never listed in the tree; if a tap lands in Poki, PokiCore brings the previous app back; Allow from the Live Activity reaches PokiCore 1.5 s after the tap.
- Live Activity margins for iOS 27's container (22 pt sides, 18 pt top/bottom; expanded island 24/18/22 pt).
- PokiCore: the action clock starts once the runner answers; per-action budgets in a batch; "buy" inside "Best Buy" is not a payment.
- The app logs when Poki came to the front during a step.

Needs the phone:
- No Poki in front after taps near the top of Mail or X; the action after Allow runs in the right app.
- Lock Screen and expanded island without clipped text.

## Round 5 (2026-11-07, after the 00:20Z phone test)

Changed:
- Events reach the screen for the app's whole life. After the first Turn off, no steps or approvals reached Home or the Live Activity (the event stream ended with the task that read it). One pump now lives in AppModel for the app's life.
- Stop really ends the runner: Poki ends the WDA session, asks the runner to shut down, the launcher ends its process, and Poki watches for up to 30 s. The "still running" notice only appears after 10 s and clears by itself once the runner is gone. The launcher reports what happened to the process.
- Live Activity: fits inside the system's height on every surface, 16 pt insets, no clipped corners; a silent small pop-up for each step; the large card for approvals; no gradients.
- Pairing is a real file check. Re-pair is always offered in Setup, a refused pairing is shown with "Pair again", the Agent tile and Setup agree, and a passcode hint shows while the runner takes long to start.
- Design: no gradients anywhere (Home, runner screens, Live Activity); rounded type on Home to match Poki Runner; the Agent tile says Idle or Working instead of Off; Copy log has an icon; the Live Activity preview link is gone from Debug.
- Runner opened by hand stays on its own screen with an Open Poki button (no automatic switch). Started by Poki it shows the in-use screen.
- Version 0.2.1 shows in Settings and the log header (was 1.0 (1)).
- Launcher: disk image mount capped at 120 s, failures named by cause (network, image refused, image bad, timeout) with the right fix; a bad image is downloaded again.

Needs the phone:
- Stop ends the runner within seconds and the notice clears.
- Each step pops up in the island and approvals show the large card with Allow and Deny.
- Scrolling and the element tree while an agent works (PokiCore fixes land next).
- Re-pair from Setup and the passcode hint after a force quit.

## Round 4 (2026-11-06, after the 11:51Z phone test)

Changed:
- Steps are plain words everywhere (PokiCore StepLabels.swift), e.g. Tap “Send”, then type “hi”. No JSON on Home, the Live Activity or in approvals.
- Home redesigned: a hero card with live tiles for Agents, Runner and Loopback, an approval card with a countdown, a Now card (current step, latest screen, Stop), setup progress, a step timeline, runner settings, and Issue cards that each name one fix (runner stopped, loopback off, offline, location denied, approval ran out, Live Activity off).
- Approvals: the Live Activity pops up by itself. If it isn't running, a notification says to open Poki.
- Runner: the idle stop default is now 2 min, so long tasks keep the banner. Every restart request is logged with whether the runner answered. Stop checks 8 s later that the runner really ended, and says so if not.
- Runner screens: PokiRunnerHost draws a designed screen as soon as the scene is up, both in use and opened by hand, so it is never black. Opened by hand, it opens Poki after 1.2 s.
- Scrolling: the loopback check no longer redraws the screens every 3 s.
- Debug: Copy log and Share log (AppLog; it never holds what is typed into password fields).
- Merged dev/ios-core db52fe9 (WeChat Send hit-test; approval time no longer eats the actions' time).

Needs the phone:
- No flicker of the automation banner during a long task, and Stop ends it within a few seconds.
- The approval pop-up and its notification; Allow and Deny from the Lock Screen.
- Opening Poki Runner by hand shows its screen, then Poki.
- Scrolling on Home stays smooth while Poki is on.
