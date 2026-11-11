# Physical iPhone setup

For remote access, see [Remote iPhone over LAN or Tailscale](remote-iphone.md). Both paths require initial trusted USB setup; cross-network access also requires Tailscale.

Physical iPhone support has been verified only with the Chinese interface in portrait orientation. Read the [verification record and known limits](verification.md) first.

Run `./bin/setup` first. It needs full Xcode and the Rust toolchain, and you do not need to set any environment variables. See the [requirements](install.md#requirements).

## First-Time USB Preparation

1. Connect the iPhone to your Mac over USB, unlock the phone, and accept **Trust This Computer**.
2. On the iPhone, enable **Developer Mode** and turn on **UI Automation** in Developer Settings. Complete all on-device prompts manually.
3. Ensure developer services are mounted before capturing screens or injecting input. If compatible Apple-signed Developer Disk Image files already exist on your Mac under `/Library/Developer/DeveloperDiskImages/iOS_DDI/Restore`, run:

```sh
node bin/prepare-device.mjs YOUR_DEVICE_ID
```

*(If exactly one device is connected, `YOUR_DEVICE_ID` can be omitted.)* This helper checks device services and mounts the local image when needed; it does not download Apple files, alter security settings, or reboot the device. To install an image from another directory, pass the directory that holds its `BuildManifest.plist` and payloads:

```sh
node bin/prepare-device.mjs YOUR_DEVICE_ID --image /absolute/path/to/Restore
```

## Touch and text input fail

Screenshots, accessibility reads, and app launch can work while touch and text input fail with `outcome: "not_sent"` and `reason: "display_service_missing"`. The result's `error` contains `no display service: ServiceNotFound`, and its `instruction` names the command below. Input needs `com.apple.coredevice.displayservice`, which the mounted developer disk image provides. `devicectl` can report a usable image that lacks it. Run `node bin/prepare-device.mjs YOUR_DEVICE_ID`, and follow its message:

- **No recognized Cryptex build identity.** The installer accepts a `BuildManifest.plist` build identity whose variant ends with `Developer Disk Image Cryptex`. The image in Xcode 26.6 (17F113) uses a variant containing `Cryptex Developer Disk Image` instead and is rejected. Use the image of a newer Xcode release, or pass a newer Apple-signed Cryptex image with `--image`.
- **Apple's signing server declined the image** (for example `STATUS=94`). Apple personalizes each developer disk image for the specific iPhone. An image older than the builds Apple currently signs for that device is one known cause. Use a newer image.
- **Another image is mounted at `/System/Developer`** (`[17: File exists]`). Quit Xcode, restart the iPhone, reconnect it over USB, unlock it, and run the helper again with Xcode closed.

## Before a test session

In **Settings > Display & Brightness > Auto-Lock**, choose a longer interval or **Never** for the test session. Turn off **Sleep Focus** and keep the iPhone unlocked with the target app visible. Restore your preferred settings after testing.

When the iPhone locks or sleeps, accessibility and input can fail or time out. Waking the screen does not unlock the phone. Unlock it manually, return to the target app, and read the screen again before retrying. Repeated retries while the phone is locked can spend time reconnecting to device services without completing the action.

After updating Poki or rebuilding the native helper, stop the running service and restart it with `npm start`. An existing service keeps its loaded JavaScript until it restarts. If it reports that it is running old code, restart it before retrying the phone task.

## Post-Pairing Wi-Fi Operation

Once paired over USB, the Mac and iPhone can communicate over the same local network for wireless discovery and supported operations while the phone stays unlocked and reachable:

- **Verified wireless operations**: Prior hardware testing (with USB disconnected) verified screenshots, accessibility field readback, standard key input, backward/forward deletion, Unicode paste, and verified paste followed by `Return`. *(Note: Those checks were not re-run as a full hardware pass after later input changes.)*
- **Native app launch**: Physical `launch_app` and `open_settings` without a page use the paired device’s RemoteXPC AppService directly. An explicit bundle ID skips application discovery; name lookup uses the advertised streaming app list. Arguments, environment, language, and locale are preserved. A positive process ID must match the observed foreground before success is reported. Foreground verification makes at most three observation attempts, with a 2.5-second attempt limit and an 8-second total deadline over USB and 6 and 20 seconds over RemotePairing, because one accessibility read of a busy screen takes about two seconds across the tunnel; child-process cleanup completes before returning. Only observation is retried, never launch. If launch may have happened but cannot be confirmed, the receipt preserves known facts and stops even a permissive batch.
- **Application discovery**: Physical `list_apps` uses the paired device’s advertised streaming app list, including for shared name resolution. System filtering retains the application-path distinction. Container-access eligibility is not supplied by this list and is not inferred.
- **Wireless limitations**: Application install/uninstall use paired InstallationProxy and verify the resulting app inventory. If an installation is interrupted, its private recovery record remains under the state directory at `install/operations/<UUID>.json`, identifying the exact possible device staging path; it is never automatically retried or deleted while its status is uncertain. Remaining process/container management and Settings deep links still use Apple `devicectl`, which may fail to discover a wirelessly paired device (`CoreDeviceError 1000`) or reject a launch (`4016`). Native input and app launch do not prove those separate management paths work.
