# Poki runner (on-phone)

The runner is the part of Poki that runs on the iPhone itself: Appium's WebDriverAgent (BSD-3-Clause,
vendored as a submodule at `WebDriverAgent/`, pinned to v16.15.3, commit `02cb92f0`), built as the
`WebDriverAgentRunner` UI-test host and branded as Poki Runner (its own icon from `docs/images/runner/`, display name, launch screen) by
`branding/brand.sh`.

## Build

There is one build path: the GitHub Actions workflow `.github/workflows/ios-runner.yml` on macOS. It
runs `xcodebuild build-for-testing` for the iOS device SDK with signing off, brands the app, strips
dSYMs and uploads two unsigned IPAs with their SHA-256 sums as the `poki-runner-unsigned` artifact:

- `poki-runner-unsigned.ipa` leaves out the XCTest libraries Xcode copies into the runner, as
  WebDriverAgent's own real-device package does; they come from the phone's developer image.
- `poki-runner-unsigned-with-frameworks.ipa` keeps them.

It runs on demand and for `ios-v*` release tags. The IPA is signed when it is installed (for
now AltStore with the user's Apple ID).

## Poki Probe

The probe (10.7.0.1 reachability and the background hold test) is now the Debug tab of the Poki app,
`native/ios-app/Poki/Debug/`.

## How Poki reaches the runner

The runner does not connect to the relay. PokiCore, inside the Poki app, dials the person's relay and
sends WebDriver requests to the runner at `127.0.0.1:8100` on the same phone. PokiLauncher starts the
runner through the phone's own developer services (`docs/ios-core.md`).

## Network boundary

The standalone app's launcher sets WebDriverAgent's `USE_IP` to `127.0.0.1`
(`native/launcher/src/launch.rs`). In the pinned WebDriverAgent this binds both port 8100 and the MJPEG
screenshot server to the phone's loopback, so another device on the Wi-Fi or cellular network cannot
reach them. PokiCore already connects to `127.0.0.1:8100` on the same phone, so this does not change its
runner path.

Mac-hosted control is separate. Poki MCP normally uses the paired native bridge or RemotePairing and
does not need port 8100. Its explicit `POKI_CUA_BACKEND=wda` mode can still connect to a WDA process
deliberately launched by the Mac with a non-loopback `USE_IP`; that exposure and its network controls
belong to that opt-in launch, not to Poki's standalone iOS launcher.

## Goals

**No unauthenticated control from the network.** The standalone runner is reachable only from the
phone itself. Poki's approval boundary remains in PokiCore, in front of the runner.

**Minimal third-party tools.** The end state is a store-distributable Poki companion app that installs
and refreshes the runner itself with the user's Apple ID (the SideStore / StikDebug approach) and
relaunches the runner after a reboot. A user needs only an Apple ID and Developer Mode. AltStore is a
stand-in until then.
