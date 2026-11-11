# Poki Gym

A small iPhone app for the iOS Simulator with one screen per case that trips UI automation. The
look/do scenarios in `native/ios/PokiCore` run against it (bundle id `nz.zheha.poki.gym`).

Open a scenario with `xcrun simctl openurl <udid> pokigym://<scenario>`, or from the menu:

| Scenario | Screen |
|---|---|
| animation | A spinner, pulsing dots and a timer that redraw every frame (the app never idles); Next changes "Taps: n" |
| alert | Show alert raises a system alert with Cancel and OK; OK sets "state: OK tapped" |
| paste | An empty text field; pasting raises iOS's paste prompt |
| list | 300 rows "Row n"; tapping Row 250 sets the state |
| sheet | Open sheet shows a half sheet with Done |
| focus | Start arms a field that takes focus 1.5 s later |
| dense | 1,500 labelled cells, so the tree is large and slow; a Found button below |
| dup | Two elements labelled Twin with the same frame over the real Twin button |
| fullscreen | A WKWebView filling the screen with one link, Open, that sets its title to Opened |
| nav | Push opens a page with the system back button; back sets "state: popped" |
| interrupt | 300 rows, and an alert ("Just a moment", Not now) 2 s after the screen opens, in the middle of a scroll |
| approval | A "Pay now" button (a payment: the agent's tap waits for the owner's approval) and a Cancel order button; the menu row avoids the payment words so only the button itself asks |

Every screen shows "Gym: <scenario>" at the top and "state: <last event>" at the bottom, so an agent
can tell where it is and what its last action did from the tree alone.

`.github/workflows/ios-gym.yml` builds the simulator app (artifact `PokiGym-simulator`) and opens
each screen once.

## Scorecard

`check/GymScorecard.swift` is the gym driver: it drives look/do through every scenario, the system
apps (Settings, Contacts or Notes, Safari, Photos), an approval (Pay now), `finish: true` and a few
faults (a look during a long action, the runner killed and restarted, a scroll_to for text that is
not there). A run fails on any call that hangs, answers without a picture, misses its budget, or
does not move the screen. It runs on both automation paths in `.github/workflows/ios-gym.yml`:

- job `scorecard` (the runner path): `check/main.swift` builds it as one more executable of the
  PokiCore package from the same branch and calls PokiCore's MCP handler against a real
  WebDriverAgent on the simulator. Table in the job summary and the `gym-scorecard` artifact.
- job `scorecard-inprocess` (the in-process path, the app's default): Poki itself, built Debug for
  the simulator, runs it through its own PokiCore and in-process session when launched with
  `-pokiInProcess gym` (`Poki/Debug/InProcessProbe.swift`); approvals are answered as the owner
  would on the Live Activity. Table in the job summary and the `gym-scorecard-inprocess` artifact,
  with `Documents/gym-scorecard.txt` and the pictures. The faults that kill the runner from outside
  are the runner path's only.
