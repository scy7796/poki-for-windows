# Agent install: steps, design and next stage

This note is for the people who maintain the install. The agent-facing guide is the skill [skills/install-poki/SKILL.md](../skills/install-poki/SKILL.md).

## Every step from zero, and who has to act

"Agent" means the installer does it with no window and no prompt. "Phone" means a person taps on the iPhone. "Input" means a person types something only they know.

| # | Step | Who | Can it go away, merge or move? |
|---|---|---|---|
| 1 | Download Poki Setup, check SHA-256, Developer ID and notarization | agent | Done by `bin/install-iphone.mjs`. A file fetched with `curl` carries no quarantine flag, so macOS shows no "downloaded from the internet" dialog, and the helper runs without the window. |
| 2 | Start Poki Setup | agent | The shipped `poki-setup-bridge` (JSON lines over stdio) is the headless mode. No change to Poki Setup was needed. |
| 3 | Choose the channel | agent | `set_channel`. |
| 4 | Apple Account password | input | Cannot go away: Apple's GSA sign-in needs it. Moved to the start, before any phone step. Typed once into the Mac's keychain with `security add-generic-password -w`, never in chat. Poki Setup keeps it for renewals, so it is asked once per Mac. |
| 5 | Two-factor code | input | Cannot go away. Once per Mac, since Poki Setup keeps the session. The code can arrive on the same iPhone. |
| 6 | Plug in by USB and unlock | phone | Needed for the first pairing and the install. |
| 7 | Trust This Computer and passcode | phone | Cannot go away: lockdown pairing needs the owner's consent. The RemotePairing record for iOS 26.4 and later is made in the same visit. Skipped when this Mac is already paired. |
| 8 | Developer Mode | phone | Cannot go away: development-signed apps do not launch without it, and the developer disk image needs it. On a phone with no passcode Poki Setup turns it on and the person only confirms after the restart. With a passcode, iOS refuses the remote switch, so Poki Setup reveals the switch and waits (Poki Setup 319). `devicectl` cannot turn it on either. |
| 9 | Sign and install Poki, pairing file, disk image | agent | Done by the bridge's `install`. |
| 10 | Trust the developer in VPN & Device Management | phone | Required for free accounts. Unverified: whether a paid team needs it, and whether `xcrun devicectl device process launch --payload-url "prefs:root=General&path=ManagedConfigurationList" com.apple.Preferences` can open that page directly (needs Xcode). |
| 11 | Open Poki once | phone | Poki writes `Documents/PokiSetup/poki-hello.json` each time it runs, and the installer reads it through the bridge's `container_read` (Poki Setup after 0.2.1) or `xcrun devicectl device copy from` (Xcode). Only with neither does the agent confirm with `done open_poki`. Poki then turns itself on: a first launch that finds Poki Setup's `signing-identity.json` sets `wantsOn`. Turning on asks for Automation Mode at once: the owner taps Continue and enters the iPhone passcode on iOS's screen. If they cancel, Poki does not ask again until it is turned on again. |
| 12 | Poki's Setup checklist on the phone (system permission prompts) | phone | iOS permission alerts need a tap. Not needed to finish the install; they come up the first time Poki needs each one. |
| 13 | Model API key for chat and voice | agent, when asked | `--model-key <provider>` reads the Mac keychain item `<provider>-api-key` and carries it sealed (below). Off by default. Without it, or with no way into Poki's files, typed on the phone. |
| 13a | Local connection (10.7.0.1) | phone | A free account's signing drops PokiTunnel, so a VPN app on the phone provides it. Poki's hello carries one sentence for the VPN app it finds (`ProxyApps`), and the installer waits until Poki says it answers. |
| 14 | Relay | input | The Cloudflare token comes from `CLOUDFLARE_API_TOKEN` or the token Poki Setup keeps; the deploy is agent work. Scanning the relay QR on the phone is still a person step. Next stage: hand the relay address over like the pairing file. |
| 15 | Self-check | agent | Install record, Developer Mode, pairing, disk image mount, relay check. |

## Design of this stage

- **Data shape.** `src/install/steps.json` is the single list: the steps in order (`id`, `who`, `title`), the person stops (`waits`, each with one sentence) and the error codes (`errors`, each with `reason`, `agent_fix`, `person`, `retry`). The runner, the guide and the tests all read it, and a test fails when the guide misses a code.
- **Runner.** `src/install/run.mjs` walks the list. Each step is a method that returns a detail line, returns `{ skipped }`, or throws. `classify` turns bridge error kinds and messages into a code. Steps the phone can heal (`trust_not_answered`, `developer_mode_off`, `phone_locked`) run again by themselves. A person stop polls for its own evidence: the keychain item, a file the agent writes with `code` or `done`, or the bridge's own wait. `run.json` records each step, so a second run resumes.
- **Transport.** `src/install/bridge.mjs` talks to the shipped `poki-setup-bridge`. Passwords and tokens go to it over stdin. `src/install/fake-bridge.mjs` speaks the same protocol with a simulated iPhone and Apple Account. The dry run and the tests use it.
- **Hand-off files.** `src/install/container.mjs` reads and writes Poki's `Documents/PokiSetup/poki-hello.json` and `model-key.json`, through the bridge's `container_read` and `container_write` (two names only, `desktop/bridge/src/main.rs`) or Xcode's `devicectl`. Poki Setup 0.2.1 answers `unknown command`, which is how the installer tells. With neither, the steps fall back to asking the person. Poki's side is `native/ios-app/Poki/Setup/PokiHandoff.swift`.
- **Diagnostics.** `src/install/report.mjs` collects versions, step results, what usbmuxd, the USB bus, `devicectl` and Bonjour each see, and the last 40 log lines. `src/install/redact.mjs` removes identifiers and secrets. Poki Setup's own support bundle masks the Apple ID only and keeps UDIDs, device names and the relay address, so it is not used here.
- **Alternative not taken.** A non-interactive mode in the Rust `poki-setup` CLI. It would need a Rust toolchain on the user's Mac, it is not in the DMG, and a Rust change on `standalone` would conflict with the Poki Setup work that is still on `dev/desktop-setup`. The bridge already in the notarized app does everything needed.

### What the diagnostics cover in issues #6, #55 and #60

| Issue | What the reporter needed | In the bundle |
|---|---|---|
| #6 usbmuxd lists no device on macOS 27.2 | macOS and Xcode versions; usbmuxd's list against the USB bus and `devicectl` | `system`, `devices.usbmuxd`, `devices.usb_iphones`, `devices.devicectl` |
| #55 RemotePairing over Wi-Fi fails | iOS version, link kind, whether the phone advertises `_remotepairing._tcp` | `phones[].ios`, `phones[].link`, `devices.remotepairing_adverts`, the pairing step's notes in the log |
| #60 JD search blocked after install | Poki build and a working device session | Only the environment part. The failure is in automating one app after the install, which is outside the installer. |

## Next stage: the install agent inside Poki Setup

Asked for on Nov 8: Poki Setup's first page asks for a model key, and an agent built into Poki Setup runs the same steps with it, diagnoses failures and drafts the issue. The same key then works in Poki on the iPhone.

- **No agent framework in Poki Setup today.** The iPhone app's loop is PiSwift (`xibbon/PiSwift`, MIT), whose package supports macOS 15 and iOS 18. Poki Setup for Mac can link `PiSwiftAgent` and `PiSwiftAI` (its floor moves from macOS 14 to 15, or the agent is offered on 15 and later). Poki Setup for Windows is Tauri and React, so it uses pi's TypeScript packages (`@earendil-works/pi-ai`, already a dependency of `agent/`).
- **Key kinds** follow `ModelProvider` in `native/ios-app/Poki/Chat/ModelKeys.swift`: Anthropic, OpenAI, Sign in with ChatGPT, DeepSeek, Gemini, OpenRouter and a custom endpoint. Poki Setup keeps the key with the core's `store::secret_set` (macOS keychain, Windows Credential Manager) under `model-key.<provider>`, the account name the iPhone uses.
- **One set of steps.** The runner moves into `desktop/core` and reads the same `steps.json` (`include_str!`). The bridge gains one command, `agent_install`, that emits these events. The model drives four tools: run the next step, read the last error, collect diagnostics, draft the issue. It never decides the step order. `bin/install-iphone.mjs` becomes a thin client of `agent_install`, so an outside agent and Poki Setup's own agent run the same code.
- **Carrying the key to the phone (built).** No plain key crosses USB. Poki makes a P-256 key in the Secure Enclave (a software key in the Keychain on a simulator) and puts its public half in `poki-hello.json`. The installer reads the key from the login keychain into its own memory, seals it with ephemeral ECDH, HKDF-SHA256 and AES-256-GCM (`src/install/model-key.mjs`), and writes only `model-key.json` (`poki.model-key/1`). The additional data binds the schema, the phone key's id, the provider, Poki's bundle id and a 10-minute expiry. Poki opens it (`ModelKeySeal.swift`), saves it with `ModelKeys.save`, selects the provider, deletes the file and the key pair, and says in its next hello which key it took. This is the construction GPT Pro's review asked for, done with plain ECDH rather than RFC 9180 HPKE so that it works with a Secure Enclave key on every iOS version Poki supports; `test/install-model-key.test.mjs` opens the installer's output with Poki's Swift code. Off by default: the agent asks the person and passes `--model-key`.
- **Split.** This PR is the shared steps, the outside-agent command, diagnostics and the issue template. The next PR adds `agent_install` to the bridge, the key page and agent in Poki Setup for Mac, the key hand-off in the core and the iPhone app, and Windows after that.

## Checks on a real iPhone (not done yet)

1. Delete any Poki on the phone, then run `node bin/install-iphone.mjs run --udid <udid>` from zero with the phone locked by a passcode.
2. Compare `node bin/install-iphone.mjs phones` with `xcrun devicectl list devices` on macOS 27.3 (the #6 symptom).
3. Tap Don't Trust once and confirm `trust_not_answered` retries.
4. Confirm whether step 10 appears for a paid team, and try the two `devicectl` shortcuts in steps 10 and 11.
5. Run `diagnose` with the phone attached and read the bundle for anything left in.
