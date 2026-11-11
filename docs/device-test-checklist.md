# Device test checklist (PokiCore and PokiLauncher)

PokiCore, the relay and the launcher are tested on Linux and macOS only (Swift tests, Rust tests, iOS builds).
These checks need the phone. Run them in order: each step relies on the one before. Write the
result and the time next to each line.

## 0. Before

- [ ] Poki (`ios-app.yml` build, or an Ad Hoc release) installed, developer trusted. Open Poki once. Poki automates the phone in its own process; Poki Runner is not installed.
- [ ] Developer Mode on (Settings → Privacy & Security → Developer Mode). On a phone that never had it on, note whether the menu appears with only Poki installed (it used to appear once Poki Runner was installed).
- [ ] Runner path only (Poki launched with `-automationPath runner`): Poki Runner (`ios-runner.yml` build) installed with the same signing tool and Apple ID as Poki; opening it by hand shows its screen and goes back to Poki. Sections 3 and 4 mark the lines that apply to this path.
- [ ] Note the iOS version and whether the phone is on Wi-Fi or cellular for each step.

## 1. Loopback (choose one; no proxy app is required with the built-in connection)

- [ ] Built-in: install the local-VPN build with Network Extensions provisioned for both Poki and
  PokiTunnel. In Setup > Connect to this iPhone, tap Enable local connection and approve iOS's VPN
  prompt. The developer-service check passes; neither a saved profile nor VPN Connected alone counts.
- [ ] Built-in: a normal web page still loads; no DNS or internet default route is installed by Poki.
- [ ] Built-in: disconnect/reconnect, lock/unlock, and reboot recover after an explicit reconnect (or,
  with Poki on, Poki's own retry below). Opening Poki alone must not start the tunnel. Choosing External app stops only Poki's VPN.
- [ ] Built-in, with Poki on: turn Poki's VPN off in Settings > VPN. It stays off (the log says `ended on
  purpose`), the agent's runner status says to open Poki and tap Enable local connection, and names no
  proxy app. Tapping it while Poki is on brings the runner back within seconds. The same when another
  VPN (LocalDevVPN) takes the packet tunnel, and after Turn off or Disconnect in Poki.
- [ ] Built-in, with Poki on: the tunnel fails without anyone turning it off (kill the PokiTunnel process:
  Xcode > Debug > Attach to Process, PokiTunnel, then stop the session). With no hand on the phone, the log
  shows `local VPN: failed`, `reconnecting in 1 s`, `connected`, `back: 10.7.0.1 answers again; starting
  the runner now`, and the next agent call works. If it keeps failing, it tries 8 times in about 2 minutes
  (1, 2, 4, 8, 16, 30, 30, 30 s) and stops; then only Enable Local Connection in Setup starts it again.
  Opening Poki dials nothing (GitHub issue 44).
- [ ] Built-in, with Poki on, the tunnel fails and a different VPN (WireGuard, a work VPN) is turned on
  before the retry comes: Poki does not dial if it detects that VPN. Setup says `Another VPN appears to be on…`, Home shows it under
  Needs attention, the log says `another VPN is on; not reconnecting`, and the other VPN stays connected. Detection is best effort: a VPN that sets no proxy, such as Tailscale, may not be detected, so Poki may still dial over it.
  Turning that VPN off and tapping Enable Local Connection brings the runner back, and the message goes.
  (The check reads the interfaces iOS has network settings for; confirm it sees a real VPN, and sees none
  with only Wi-Fi or cellular.)
- [ ] Installed over 0.2.3 with a proxy app that was set up only in the proxy app (no connection
  chosen in Poki): Turn on says to choose a local connection first, and Setup > External app > Use
  the current VPN brings it back. Say this in the release notes for 0.2.3 users.
- [ ] External build: no PokiTunnel is embedded and no built-in enable button is offered. Continue
  with an external option below. Use this build when Network Extension signing is unavailable.
- [ ] Or LocalDevVPN (App Store) on, for people without a proxy app.
- [ ] Or Shadowrocket "Include route 10.7.0.1/32" on, with Shadowrocket connected.
- [ ] Or Surge Enhanced Mode with the Poki module (`10.7.0.1 = reflect`), or Loon's plugin, or sing-box `loopback_address`.
- [ ] With a proxy app: a web page still loads through the proxy (the proxy keeps working).

## 2. Pairing on the phone (iOS 27)

- [ ] Start pairing in Poki: the launcher emits `advertise`, and Poki appears in Settings' list of computers to pair with.
- [ ] Pick it: a PIN appears in Poki's Live Activity; type it on the phone.
- [ ] `paired` arrives with a path; the file is in the app's container (never print its contents).
- [ ] Start pairing, then leave Settings without pairing: after 10 minutes Poki stops waiting (Try again
  shows), the Live Activity ends, and Poki no longer keeps itself running. Switching to another tab, or
  opening another Setup step, while pairing cancels it at once.
- [ ] Older iOS, or if this fails: use a pairing file made on a Mac (RPPairing or lockdown plist) and note which kind worked.

## 3. Launcher

- [ ] States move: connecting → pairing → (mounting_ddi on the first run after a restart) → running, with no launching (the launcher only mounts the disk image). Note the time of each.
- [ ] Mounting needs the internet: try it once with Wi-Fi and once on cellular.
- [ ] `running` within 60 s, then the Poki log shows `in-process session ready` (the first time, iOS may ask for the passcode to allow automation). Note the seconds it reports. Then PokiCore `look` answers.
- [ ] Cancel the passcode prompt on a first open: the log shows `in-process session not ready`, and the agent's next `look` answers at once with `runner: failed` and the reason, not `starting` after 15 s. The call after that opens the session again.
- [ ] Background Poki and use other apps for 5 minutes: `look` and `do` still answer; if the session ended, the first call opens it again. Note what that first call answers and how long it took.
- [ ] Lock the phone for 2 minutes, unlock, then `do` once: the action is not sent to the ended session; a new session is opened and the action goes there. Note the time until it is back.
- [ ] Runner path only: states pass through launching; kill Poki Runner from the app switcher and within about 10 s the launcher relaunches it (`launching`, then `running`).
- [ ] Runner path only: background Poki for 5 minutes and lock the phone for 2 minutes; the runner stays up (the runner dies about 30 s after the launcher's connections close).
- [ ] Switch Wi-Fi off and on, and to cellular: does the launcher keep or regain `running`? Earlier tests over Tailscale found new developer connections only on Wi-Fi; record whether the loopback changes that.
- [ ] Turn the loopback off: the state becomes `waiting_network` with the fix text, and back to `running` after it is turned on again.

## 4. PokiCore through the relay

- [ ] Deploy your relay (`deploy/cf-relay/deploy.sh`) and enter its address in Connect. The relay state reaches `ready`; the connector URL (`https://<relay host>/v1/<label>/<secret>/mcp`) is shown in Poki.
- [ ] Add it in Claude as a connector; `tools/list` shows look, do, status.
- [ ] `look` within 2 s, with a screenshot and elements.
- [ ] A Clock task (World Clock → add a city) and a Notes task, timed from the first call to the last.
- [ ] Force a hang: lock the phone during a long `do` (Runner path: background or kill Poki Runner's app); the call answers within 25 s, says what may have been delivered, and the next `look` answers at once.
- [ ] Phone offline (airplane mode): the MCP client gets the relay's "The phone is offline" error, not a hang.

## 5. Approvals

- [ ] `do` tapping a Delete button in Photos: nothing happens on screen, the Live Activity asks, the answer says `approval_required`.
- [ ] Approve in the Live Activity after 45 s, without sending anything again: the same call goes on and taps, and the answer says `approved on the phone after 45 s`. Allow does not bring Poki to the front: the phone stays in the app it was in, and the tap lands there.
- [ ] Do not approve: after about 115 s (about 50 s behind a relay still at `REQ_TIMEOUT_MS` 60000) the answer says `approval_required`. Approve afterwards and send the same actions: it taps once; a third time asks again.
- [ ] Behind a relay still at `REQ_TIMEOUT_MS` 60000, approve at about 52 s: the answer says `approval_required` and the owner approved too late; nothing was tapped. Send the same actions again: they run at once.
- [ ] Decline: `not_sent: the owner declined`.
- [ ] While an approval is pending, have the agent tap the Live Activity's Approve button (`do` with the button's point): the pending request is withdrawn first, so nothing is approved.
- [ ] Typing into a password field asks first, and the Live Activity hides the text.
- [ ] A fresh install (or an alpha that never touched the switch): Agents › Approvals › Ask Before Sensitive Steps is on, and the first Delete asks.
- [ ] With Poki in front while an agent's approval waits (the Dynamic Island hides Poki's own Live Activity then): the chat shows Allow this step? with Allow and Don't Allow; Allow runs the step and the phone goes back to the app the agent was in.
- [ ] Leave an approval unanswered and send nothing more: after 2 minutes the Live Activity leaves Approval, Poki says the approval ran out, and the idle stop works again.
- [ ] In Wallet: the agent can wait, hand the screen to you and press Home without being asked; a tap asks.
- [ ] In Wallet, `do {run: name}` of a saved routine asks before anything is tapped.
- [ ] In WeChat: tap the message field, type, then `{key: "return"}`: it asks before the return, and nothing is sent. In WeChat's search field the same return searches without asking, also after `{type: "…", ref: n}` on it. In the chat list, a `do` that taps a chat and then types by the search field's number from the list asks before the return.
- [ ] In WeChat, `do {run: {name, with: {text_1: "…\n"}}}` of a saved routine that types into the message field: the run stops before that step, and nothing is sent.
- [ ] `do [{launch: "com.apple.mobileslideshow"}, {wait: 500}, {tap: [x, y]}]`: Photos opens, then it asks before the tap.

## 6. Live Activity

- [ ] It shows the current call (tool and summary), then the app and the thumbnail after each call.
- [ ] It stays while Poki is in the background, and ends when Poki stops.
