# Handoff: the `standalone` branch, the first alpha and the rolling test releases

First written Nov 8 2026, 4:20 am ET (Philadelphia time); brought up to date Nov 8, 10:10 am ET. It is
for Joseph and the agents working for him. It covers
what `standalone` is, how it was put together, how releases and channels work now, what Poki Setup
does, what was checked and what was not, and what is still open. Read `HANDOFF.md` (the
`poki/ios-integration` handoff) and `docs/NOTE-FOR-JOSEPHS-AGENT.md` (the earlier
`dev/ios-standalone` note) for the history before this.

## In one paragraph

`standalone` is the full state of Zhehan's standalone iPhone work as of the first pre-alpha. It has
full history and no squashes. It is the native SwiftUI revamp of the iPhone app (`native/ios-app`),
plus on-device self-signing (Poki re-signs and updates itself, free Apple accounts included), plus
Poki Setup for Mac and Windows (`desktop/`), plus a release-channel system (Stable, Beta, Alpha,
Pre-alpha) on this repository's GitHub Releases. Alpha and Pre-alpha each live in one **rolling**
prerelease, `ios-alpha-latest` and `ios-prealpha-latest`, that every cut updates in place. Both hold
Poki 0.2.8 (501, built from `26924dc`) with Poki Setup 0.2.1 (319). Only Stable is ever marked Latest
(today that is Joseph's `v0.1.1`). Nothing on `main` was touched and no PR is open.

## What changed since the first version of this file (Nov 8, 4:20 am to 10:10 am ET)

- **Releases are mutable now, and the test channels roll.** Zhehan turned off release immutability
  for this repository. `bdfc022` changed `channel-release.yml` so a cut replaces the files, title and
  notes of `ios-<channel>-latest` instead of making a new release. The earlier per-build releases
  (the last were `ios-alpha-0.2.8-501` and `ios-prealpha-0.2.8-501`) and their tags were deleted; the only `ios-*` tags left are the two rolling ones, both on `26924dc`.
- **Poki 0.2.8 (501) plus Poki Setup 319 are in both rolling releases.** The notes name the build in
  the title ("Poki v0.2.8 (501) Alpha" / "Pre-alpha").
- **Both apps update themselves.** Poki Setup checks its channel at launch and every 6 hours, offers
  Restart to Update and verifies the download against `SHA256SUMS-desktop.txt` (on a Mac the new app
  must carry the same team's valid signature). The iPhone app pre-signs updates from the channel
  picked in Settings › Signing and installs only when the owner taps Install.
- **Poki Setup fixes on fork `dev/desktop-setup` (head `3d16c3a`, build 319), not yet merged into
  `standalone`** (which still has the desktop code of `c465a5a`, build 307):
  - `3df82dc` self-update (above).
  - `40ab70e` texting the Apple sign-in code works again (HTTP 405 from a doubled Content-Type);
    `745043e` waits for a code from an Apple device when Apple will not text one.
  - `051fb87` 2FA code delivery: the code is also pushed to the person's devices when Apple offers
    SMS, a code from either place is accepted, HTTP 201 counts as sent. Its change to name Xcode's
    AuthKit client was **reverted** in `77ff081`, because Apple then refused every sign-in with HTTP
    503. Keep the anisette server's own `X-MMe-Client-Info`.
  - `efac471` Developer Mode: amfid answers one request per connection, so status, reveal and enable
    each open a fresh connection (the old code failed with "device socket io failed").
  - `8fe332a`, `afc54c0`, `3d16c3a` a device with a passcode set can't have Developer Mode turned on
    remotely, so Poki Setup shows it as a guided step (Settings › Privacy & Security) and waits up to
    ten minutes, instead of "unknown error Device has a passcode set".
  - `5d263e1` release selection picks the highest version and build on a channel, not the first
    release GitHub lists, so a rolling release is never shadowed; `ios-beta-*` and `desktop-beta-*`
    count as Beta. The iPhone app links the same core but has the `c465a5a` copy, so it gets this only
    after `standalone` (and the revamp) merge `dev/desktop-setup` again.
- **iOS fixes on fork `dev/ios-native-revamp` (head `ed96a18`), not built and not in `standalone`:**
  `c5721db` the screen does not dim or lock while a task runs (`isIdleTimerDisabled`, while Poki is in
  front); `ed96a18` the chat log gives a failed task's reason, a launcher that never reached the phone
  stops retrying while standing by, and the continued-run (BGContinuedProcessingTask) registration
  falls back to one fixed identifier when iOS refuses the wildcard. `c7ff93b` (fast IPA build, Rust
  library cached) is on both lines.

## Ground rules (unchanged, please keep them)

- Never push to `main`; no PR unless Zhehan or Joseph asks for one.
- Never force-push. Fast-forward only; if someone else's work is on a branch, pull first.
- Commits meant for this repository are authored as ZhehanZhang (`github@zhehanz.com`), with no
  `Co-Authored-By` trailers and no agent session links.
- Branch names use the `dev/` prefix (except the user-named `standalone`).
- CI runs only on tags or by hand on this repository; nothing builds on a branch push except the
  `dev/desktop-*` desktop workflows (see below).
- A claim about the phone counts only when it was seen on a real device. Simulator-only and
  compile-only facts are marked as such below.

## How `standalone` was built

The first-parent history of `standalone` is a series of merges. From oldest to newest:

| Commit | What |
| --- | --- |
| `4b2f26f` and earlier | Fork `dev/ios-native-revamp`: the native SwiftUI revamp of the app, built on `poki/ios-integration` (it contains `ea223c5`, `c9343e1` and the `22cad01` HANDOFF). The self-refresh work (`dev/self-refresh`) is merged into it. |
| `03c5a83`, `012e5e3` | Release channels: `channel-release.yml`, `cut-release.sh`, `docs/release-channels.md` (first Pre-alpha, then Alpha). |
| `b4a67d2` | The iOS IPA workflow can be called by `channel-release.yml` (inputs `version`, `build`, `editions`). |
| `53ff4aa`, `a4e09bb` | Releases attach the relay Worker (`poki-relay-worker.js`, listed in `SHA256SUMS`) and the release notes link it. |
| `ea68952`, `9ebaf1e`, `8905942` | Merges of fork `dev/desktop-setup` (Poki Setup 0.2.1 builds 297 to 299). `8905942` resolved conflicts in `desktop/core/src/relay.rs` and `desktop/core/src/apple/store.rs`; see "Rust core features" below. |
| `1a0e05c` | CI split: `ios-app.yml` is the full workflow again (tests, simulator, screenshots, restored from before `dc2cb40`), and `ios-ipa.yml` is the fast unsigned IPA build that `channel-release.yml` calls. |
| `3ad8e56`, `c48e15f`, `bff458e` | Merges of `dev/ios-native-revamp` up to `b8c243a`: pairing fixes (`422788e`, `7ca2b55`), aws-lc pinned as the TLS provider (`f5fb69c`), the voice restart fix, the separate on-device pairing file, and chat scrolling. |
| `5c42d82`, `297ba04`, `71e16b7`, `13656d7`, then the `c465a5a` merge | Merges of `dev/desktop-setup` up to `c465a5a` (Poki Setup 0.2.1 build 307: the signer renames `BGTaskSchedulerPermittedIdentifiers` to the signed bundle id, and the Mac sidebar fix). Before that `a121d41` (build 304). |
| `02fd595`, `2afe565`, the `8519c32` merge, then the `41509e8` merge, then `d73ebf4` (this file for 499) | Merges of `dev/ios-native-revamp` up to `41509e8` (one in-process automation session per launch, so turning Poki back on after Off relaunches it from a notice; stand-by drops the banner but keeps the session; ask_poki off by default under Settings › Diagnostics › Testing). Before that `8519c32` (approval switches with the auto-classifier, background keep-alive, ask_poki for repetitive tasks); before that `2b9ec5b` (approvals off by default for this alpha; Settings › Approvals › Ask Before Sensitive Steps turns them back on). Before that, `d7e91b2`: Install button fix, Stop ignored right after Allow, the session stays open while idle, screen reader recovery after a reopen, Hide Banner When Idle. |

Fork sources, all on ZhehanZhang/poki-remote: `dev/ios-native-revamp` at `41509e8` and
`dev/desktop-setup` at `c465a5a`. The prepared branch was `dev/standalone-cand`.

After those merges, three commits went straight onto `standalone`: `7e71af4` (launcher `Cargo.lock`
records poki-setup-core 0.2.1, since the release build runs cargo `--locked`), `26924dc` (`ios-ipa.yml`
is the fast device-only IPA build with the Rust library cached by its sources; channel releases build
only the external edition) and `bdfc022` (rolling releases). The 501 build is `26924dc`.

### Not in `standalone`

`main` is not an ancestor of `standalone`. About 71 commits on `main` are not in it (counted Nov 8).
`dev/ios-standalone` is fully included.

`poki/ios-integration` moved on after `standalone` forked from it. Its `db0e8ea` and the four
commits before it (PRs #48, #50, #51, #52, #54: in-process session idle end, voice listening and
background fixes, voice with the phone's own OpenAI key) are **not** in `standalone`. The revamp
has its own bridgeless voice that uses the phone's OpenAI key (`fd6cec8` and later), so expect
conflicts in `native/ios-app/Poki/Voice` and the in-process session code when the two lines are
merged. Nobody has done that merge yet.

## The iPhone app (`native/ios-app`)

- Version in `native/ios-app/VERSION` (0.2.8). The build number is always
  `git rev-list --count HEAD` (full-history checkout), so a later commit always has a bigger one.
- Minimum iOS 18.0. iOS 17.6 is blocked only by PiSwift.
- **UI rule from Zhehan:** native SwiftUI only. Standard components, Liquid Glass on iOS 26 and
  later with fallbacks to iOS 18. No custom UI and no overlays. Review every screen against this
  before you add one.
- Tabs: Poki (sessions and chat), Agents (connectors), Setup (status, checklist, signing).
- The default is one app: automation runs in Poki's own process. Poki Runner is optional
  (Settings › Diagnostics).
- Chat and voice run on the phone: PiSwift (`pi`) is the model loop, accounts are Anthropic,
  OpenAI, DeepSeek, Gemini or Sign in with ChatGPT (PiSwift `loginOpenAIChatGPT`). Live voice uses
  OpenAI Realtime with the phone's key; other models get hold-to-dictate plus TTS.
- Gotcha: PiSwiftAI exports a type called `Context`. In a file that imports it, a
  `UIViewRepresentable` must write `UIViewRepresentableContext<Self>`.

### Self-signing (`native/ios-app/Poki/Signing`, `native/launcher/src/signer.rs`)

- Poki Setup writes the signing identity into Poki's container as
  `Documents/PokiSetup/signing-identity.json` (schema `poki.signing-identity/1`) on install and on
  renewal. Poki moves it into its own Keychain.
- The Rust signer is Poki Setup's core (`desktop/core`), linked into `native/launcher` as a static
  library. It installs through installation_proxy and misagent over the 10.7.0.1 loopback.
  Anisette comes from remote v3 servers (`new.ani.sidestore.io`, then fallbacks).
- Zhehan's rules for it: refresh status and a countdown on the Setup page; updates are
  pre-downloaded and pre-signed for the chosen channel (same code as the desktop, `release.rs`);
  an install never lands by itself. Poki holds a ready build until it is idle and the owner taps
  Install (buttons "Prepare Refresh Now", then "Install Refresh"; the row "Signed Until").
- **TLS gotcha (cost us a night):** the signer's anisette client installed `ring` as rustls'
  process-wide provider, and after that the phone's lockdown TLS failed with "device socket io
  failed". `f5fb69c` pins aws-lc as the process provider in PokiLauncher before anything
  connects. Don't let any crate install a different default provider.
- **Pairing gotcha:** on-device pairing works, but only after the iPhone passcode is entered when
  iOS asks. A failure at that step looks like "no pairing code ever appears". Check the passcode
  step before you debug the code path.

## Poki Setup (`desktop/`)

- `desktop/core`: everything, no UI (Rust). `desktop/cli`: `poki-setup`. `desktop/bridge`:
  JSON lines over stdio for the Mac app. `desktop/mac`: native SwiftUI Mac app (SwiftPM, macOS 14+,
  Liquid Glass on 26). `desktop/app`: Tauri 2 Windows app with the same layout.
- Version 0.2.1 in `desktop/Cargo.toml`, `tauri.conf.json` and `package.json`. The build number is
  **not stored**: CI computes it as the commit count of the commit it builds (`POKI_SETUP_BUILD`).
  319 is `3d16c3a` on `dev/desktop-setup` (307 was `c465a5a`). An installer built from `standalone`
  would carry `standalone`'s count instead, so the releases attach installers built from the desktop
  branch.
- Release channels (`desktop/core/src/release.rs`): `Channel` = Stable, Beta, Alpha, PreAlpha,
  saved in `state/channel.json`, overridable with env `POKI_RELEASE_CHANNEL`. Each channel includes
  the more stable ones. If a channel has no release yet, it steps down toward Stable. The default is
  Stable. CLI: `poki-setup channel [name]`, `poki-setup release --all`. Mac: the Poki row on the Setup
  page. Windows: Settings › Updates.
- Self-update reads **any** release on the channel, `ios-*` included, for assets named
  `PokiSetup-<ver>-<build>-macos.dmg` or `PokiSetup-<ver>-<build>-windows-x64-setup.exe`. Keep
  those names exact. Since `3df82dc` it checks at launch and every 6 hours, checks the file against
  `SHA256SUMS-desktop.txt`, and the newest installer on the channel wins. Versions come from the asset
  names, not the tag, which is why `ios-*-latest` tags work.
- Relay: Update Relay downloads `poki-relay-worker.js` from the release that matches the installed
  Poki and checks it against `SHA256SUMS`, with the bundled copy as a fallback. Zhehan called
  shipping an old relay "unacceptable", so keep it this way. The Cloudflare API token is kept in the
  keychain (`cloudflare-relay-token`), and Forget removes it.
- Sign-in: Apple GSA (SRP-6a, 2FA by trusted device or SMS). Anisette is remote by default
  everywhere (macOS 27's AOSKit gives no X-Apple-MD). `ani.sidestore.io` serves Android data under
  Mac client info and causes ec -80045; use `new.ani.sidestore.io` and rotate on -80045/-80046.
- Any Apple ID works. Each team gets `nz.zheha.poki.<TEAM>`, `.widgets` and
  `group.nz.zheha.poki.<TEAM>`. The packet-tunnel extension is always left out (a team profile
  can't carry it), so tester-signed builds need a proxy app for the loopback (Karing, Stash,
  Quantumult X, Clash Mi, plus the modules in `deploy/proxy-modules`).
- Builds 300 and 301 had a pairing QR "data too long" bug. 302 fixes it, makes a Remote Pairing
  (RPPairing) record over USB for iOS 26.4+, and never overwrites a pairing Poki made itself.
- Sign-in gotchas from Nov 8: Apple returns HTTP 503 for anisette sent under another client's name
  (keep the anisette server's own `X-MMe-Client-Info`), and HTTP 405 when the SMS request carries two
  Content-Types. Developer Mode over amfid needs a new connection per request, and can't be enabled
  remotely on a device with a passcode.
- Mac notarization was done on Zhehan's Mac (Developer ID Application: Zhehan Zhang, team
  Q64ZL36CJN, notarytool profile `console-neo`). CI supports `MACOS_CERT_P12` and `NOTARY_*`
  secrets, but none are set here.

### Rust core features (read before touching `desktop/core`)

- Features `device` and `os-keychain` are on by default. Poki on the iPhone builds the core with
  **no default features** and installs its own vault (`crate::vault`).
- `apple/store.rs` `secret_get/set/delete` try `crate::vault::installed()` first, then file mode,
  then the OS keyring (only with `os-keychain`).
- Anything that talks to a device over USB needs `#[cfg(feature = "device")]` (for example
  `setup.rs` `hand_signing_identity`).
- Always run `cargo check -p poki-setup-core --no-default-features` as well as the normal build,
  or the iPhone build breaks without anyone noticing on the desktop.
- Linux needs `libdbus-1-dev` and `pkg-config` for the keyring crate.

## Approvals: on by default from `fix/ask-before-default` (ESP-211)

Zhehan's call for 501 (Nov 8, 5:14 am ET) was to approve everything by default, because the prompts slowed tasks
down and the in-app prompt could not be answered while an agent drove the phone. `fix/ask-before-default` turns
Ask Before Sensitive Steps back on by default and fixes what made it hard to use:

- The switch is in Agents › Approvals again and is on unless the owner turned it off (`approvals.ask` unset reads as on).
- An unanswered request ends by itself after its 120 s, so the Live Activity, the idle stop and Stop Runner no longer
  wait for the agent's next call.
- Wallet asks for taps, typing, keys, drags and routine runs; waiting, handing the screen to the owner, swipes, pinches, `scroll_to`, `back`, the hardware buttons and leaving go without asking.
- The chat shows Allow and Don't Allow while an approval waits, because iOS hides Poki's own Live Activity in the
  Dynamic Island while Poki is in front.
- Actions after a `launch`, Home or `run` in the same `do` are checked against the launched app, and a tap after a `launch` or `run` asks;
  any tap in Phone asks. A point tapped after a tap in the same `do` asks, and in a messaging app any such tap.
- Return in a messaging app asks (WeChat, WhatsApp and Telegram send on it), except in a search field (the one tapped, or typed into by its number, in that `do` before any action in it may have changed the screen).
- A routine run checks each step it sends by the same rules, a typing step on an element included, and stops before one that needs approval.

The Auto-Classifier stays under Diagnostics › Testing (off by default) and answers in the owner's place when it is on.
ask_poki Tool is unchanged (off). Only the simulator has seen this; the real-phone checks are in
`docs/device-test-checklist.md` section 5.

Also from `8519c32`: on iOS 26 and later Poki keeps running with a BGContinuedProcessingTask instead of silent audio
and location. `desktop/core` `sign/mod.rs` now rewrites `BGTaskSchedulerPermittedIdentifiers` to the signed bundle
id. Poki Setup 307 and later have that change; with an older Setup (304) iOS refuses the task and Poki falls back to
silent audio (safe). `ed96a18` (not built yet) also falls back to one fixed identifier when iOS refuses the wildcard.

## Tag ruleset

This repository's "Protect tags" ruleset (rules/26676466) blocks tag creation for everyone without admin, except
`ios-prealpha-*`, `ios-alpha-*` and `ios-beta-*`, which are excluded (since Nov 8). Any other tag name needs Joseph.

## Releases and channels (`docs/release-channels.md`)

Release immutability is **off** for this repository (Zhehan, Nov 8), so releases can be edited after
they are published.

| Channel | Tag you push to cut | GitHub release |
| --- | --- | --- |
| Stable | `ios-vX.Y.Z` | full release, the only one marked Latest |
| Beta | `ios-vX.Y.Z` | prerelease (every `ios-v*` starts as one) |
| Alpha | `ios-alpha-<VERSION>-<count>` | the rolling prerelease `ios-alpha-latest` |
| Pre-alpha | `ios-prealpha-<VERSION>-<count>` | the rolling prerelease `ios-prealpha-latest` |

- `release.yml` handles `ios-v*`. `channel-release.yml` handles `ios-alpha-*` and `ios-prealpha-*`.
  Both run only on tags, and a tag push runs the workflow file **at the tagged commit**, so the
  workflow must be in that commit.
- `channel-release.yml` checks that the tag is exactly `ios-<channel>-<VERSION>-<count>`, calls
  `ios-ipa.yml` with `editions: local external` (a failed local edition only warns; a failed external
  edition fails the release). Since `26924dc` it builds only the external edition. Since `bdfc022` it
  puts `Poki-external-<V>-<B>.ipa`, `Poki-signing.zip`, `poki-relay-worker.js` and `SHA256SUMS` into
  `ios-<channel>-latest`: it deletes the previous build's Poki files from that release (Poki Setup's
  installers and `SHA256SUMS-desktop.txt` are kept), uploads the new ones, and sets the title
  ("Poki <V> (<B>) Alpha") and notes. If the rolling release does not exist yet, it creates it. It is
  always a prerelease with `--latest=false`, so the Mac server's update check (`releases/latest`)
  never sees it. The workflow ignores pushes of the `-latest` tags themselves.
- To cut one: `native/ios-app/scripts/cut-release.sh pre-alpha <ref>` (or `alpha`). `DRY_RUN=1`
  prints the tag. **Always pass the ref.** The default is `origin/poki/ios-integration`, which lacks
  `channel-release.yml` today. The script refuses a commit that isn't on the remote or that lacks
  `channel-release.yml`.
- Then replace the Poki Setup installers on the rolling release when there is a newer Setup build
  (exact names, plus `SHA256SUMS-desktop.txt`; `gh release upload ios-alpha-latest ... --clobber`, and
  delete the older installer so only the newest one is on it), and replace the generated notes with the
  final text (`gh release edit --notes-file`). Edit the 7-language notes in place; no bold in the CJK
  parts.
- The versioned tag you pushed is the build's only record once its files are replaced. The earlier versioned
  tags were deleted on Nov 8 together with their releases, so today only the two `-latest` tags exist.
- The `desktop-*.yml` workflows run on `desktop-v*` tags, on `dev/desktop-*` pushes, or by hand. No
  workflow publishes `desktop-prealpha-*` releases yet. Self-update works anyway because it reads
  the installers attached to `ios-*` releases.

### Superseded pre-alpha candidates (never pushed, do not push; kept for history)

| Tag that would have been | Commit | Why it was dropped |
| --- | --- | --- |
| `ios-prealpha-0.2.8-450` | `9ebaf1e` | Poki Setup 298; superseded by the token-in-keychain build |
| `ios-prealpha-0.2.8-453` | `1a0e05c` | iOS `4b2f26f`: pairing reported broken (it was the passcode step) |
| `ios-prealpha-0.2.8-458` | `5c42d82` | Poki Setup 300: pairing QR "data too long" |
| `ios-prealpha-0.2.8-467` | `bff458e` | Poki Setup 301: same QR bug |
| `ios-prealpha-0.2.8-469` | `71e16b7` | Poki Setup 302: Windows installers failed in CI; 304 is the same code |
| `ios-prealpha-0.2.8-472` | `13656d7` | iOS `b8c243a`; replaced by iOS `d7e91b2` |
| `ios-prealpha-0.2.8-478` | `02fd595` | iOS `d7e91b2`; replaced by `2b9ec5b` (approvals off by default) |
| `ios-prealpha-0.2.8-482` | `ecd655d` | iOS `2b9ec5b`; replaced by `8519c32` (Approvals (Testing), auto-classifier, keep-alive) |
| `ios-prealpha-0.2.8-490` | `6c73cff` | iOS `8519c32` and Poki Setup 304; replaced by `41509e8` and Setup 307 |
| `ios-prealpha-0.2.8-499` | `d73ebf4` | iOS `41509e8` and Poki Setup 307; replaced by 501 (no release or tag left) |
| `ios-alpha-0.2.8-501`, `ios-prealpha-0.2.8-501` | `26924dc` | Published as separate (immutable) releases, then deleted Nov 8 once immutability was off; the same build now sits in both rolling releases |

## The relay (`deploy/cf-relay`)

- A Cloudflare Worker, frames v1 (spec in `docs/ios-core.md`). It stores nothing except a budget
  Durable Object.
- Zhehan's live relay is `poki-relay` at `pokimcp.zheha.nz/v1/*` and `/.well-known/*`. As of Nov 8,
  2:00 am ET it runs the revamp's relay with `REDIRECT_HOSTS` removed: any https redirect plus
  loopback and agent app schemes register, and a callback outside `KNOWN_HOSTS` needs the owner's
  OK on the phone (consent frames, 90 s). That fixed upstream issue #43 (Poke, Meta AI). Rollback:
  version `1d0fc696-2b45-4d58-bccf-caf2aa33acef`.
- Testers update their own relay with Poki Setup's Update Relay, or paste `poki-relay-worker.js`
  into the Worker's Edit code. Address and secret stay the same.

## What was checked

- Pairing works on Zhehan's iPhone 17 Pro (iOS 27.3 beta) with `b8c243a`, after the passcode step.
- `channel-release.yml` ran end to end for 501 (runs 42479919309 and 42479919285, as drafts that were
  then published). The rolling-release path of `bdfc022` has not cut a build yet: the two
  `ios-*-latest` releases were made by hand (published 8:40 am ET, just before `bdfc022`). Watch the first cut after it.
- iOS CI is green for `b8c243a` (run 42465254776) and `d7e91b2` (run 42468937314). It is compile-and-package only; simulator
  checks are in the full `ios-app.yml`.
- `cargo check -p poki-setup-core --no-default-features` passes at `02fd595`, and the core's 19
  tests passed at the `8905942` merge.
- `git rev-list --count` of `26924dc` is 501, which is the build number in both rolling releases.

## What was not checked

- The iPhone app's own update path against the rolling releases (it links the `c465a5a` core, which
  picks the first release GitHub lists on the channel, not the highest build).
- `c5721db` and `ed96a18` on the revamp: committed and pushed to the fork only, no IPA built yet.
- Installs with anyone else's Apple ID, a free account, another paid team, or on Windows. Free
  accounts allow one development certificate, so an AltStore, SideStore or Xcode certificate on the
  same Apple ID blocks Poki Setup. They also allow 3 apps at a time and 10 App IDs a week (Poki uses
  2). Apple's raw error comes through for the App ID limit.
- The full test list for pre-alpha testers is in the release notes: first install and pairing,
  self-renewal, relay deploy plus an external agent, chat and live voice, and Lock Screen approvals.

## Open items

1. Merge `poki/ios-integration` (`db0e8ea`, PRs #48 to #54) with `standalone`, and resolve voice
   and in-process session conflicts.
2. Merge fork `dev/desktop-setup` (`3d16c3a`, Setup 319) and `dev/ios-native-revamp` (`ed96a18`)
   into `standalone`, then cut the next Pre-alpha with `cut-release.sh pre-alpha origin/standalone`.
3. A `desktop-prealpha-*` or `desktop-v*` release path for Poki Setup in CI, with the notarization
   secrets, so installers no longer come from Zhehan's Mac.
4. A friendly message for Apple's App ID limit on free accounts, and for the one-certificate
   conflict with other sideloading tools.
5. Five stray "Poki Setup on this computer" certificates on team Q64ZL36CJN from early testing
   should be revoked.
6. Poki Runner is still built and documented. Decide whether it stays an option or goes.
7. Known limitations in 499 and 501, listed in the release notes as fixes pending: the iOS automation banner stays on
   screen for the whole time an agent works and whenever Poki is awake, and restarting Poki (Off, then on) quits the app and relaunches it, coming back from
   the Tap to Open Poki notice when iOS does not reopen it, because there is one automation session per launch.

## Where things are

- Release notes: the GitHub releases `ios-alpha-latest` and `ios-prealpha-latest` (both Poki 0.2.8 (501)
  and Poki Setup 319 today). Testers pick Alpha; Zhehan tests on Pre-alpha and proven fixes ship as
  Alpha versions, many before the first Beta.
- Fork with all `dev/` branches: https://github.com/ZhehanZhang/poki-remote
- Release channels: `docs/release-channels.md`. Poki Setup: `desktop/README.md`,
  `desktop/mac/README.md`. App: `native/ios-app/README.md`. Relay: `deploy/cf-relay/DEPLOY.md`,
  `OPS.md`, `PRIVACY.md`.
