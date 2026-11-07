# Poki MCP on Windows

This is the Windows port of the checkout in this directory. It runs the same MCP
server, the same tools and the same Rust bridge as the macOS original; what differs
is how the host reaches the phone, where state lives, and which tools cannot exist
without Xcode. Everything below was read out of the source and then checked on a
Windows 11 host against a real iPhone.

## The one prerequisite nobody expects: the Apple USB service

macOS runs `usbmuxd` and every helper dials `/var/run/usbmuxd`. Windows has no such
socket. `idevice` handles this itself — `UsbmuxdAddr::default()` returns a TCP address
on non-Unix hosts:

```rust
// .deps/idevice/idevice/src/usbmuxd/mod.rs
#[cfg(not(unix))]
{ Self::TcpSocket(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::new(127,0,0,1), Self::DEFAULT_PORT))) }
pub const DEFAULT_PORT: u16 = 27015;
```

Port 27015 belongs to `AppleMobileDeviceProcess.exe`, which the **Apple Devices**
app starts. Nothing listens there until that app runs, so every device call fails
with `ConnectionRefused` (WSAECONNREFUSED, 10061) until you open it:

```
Start-Process explorer.exe 'shell:AppsFolder\AppleInc.AppleDevices_nzyj5cx40ttqa!App'
Test-NetConnection 127.0.0.1 -Port 27015      # must be True
```

`native/devices.py` reads the same service over TCP on Windows and keeps the Unix
socket path elsewhere; `USBMUXD_SOCKET_ADDRESS` overrides both.

## Building

The macOS build script cannot run here: it calls `xcrun swiftc` for the OCR helper and
`xcrun clang` for the simulator driver. `bin/build-native.mjs` builds the bridge
everywhere and adds those two only on macOS.

Two things about the Rust side on Windows:

* **The MSVC C++ workload may be absent.** `link.exe` then fails with
  `LNK1104: cannot open file 'msvcrt.lib'` because the C++ runtime libraries are not
  installed, even when the Windows SDK headers are. The working toolchain here is
  `x86_64-pc-windows-gnu`, which rustup ships with its own linker inputs.
* **`aws-lc` needs CMake, NASM and Perl.** None of them are part of a default install,
  and `idevice/Cargo.toml` defaults to it. The `rustcrypto` feature is a pure-Rust TLS
  backend, so the pinned `idevice` and the bridge build with cargo alone:

  ```powershell
  cargo build --release --no-default-features --features rustcrypto `
      -p idevice-tools --bin idevice-tools --bin idevice_id
  ```

  `bin/setup.ps1` rewrites `default = ["aws-lc"]` to `["rustcrypto"]` in the pinned
  checkout, and `native/bridge/Cargo.toml` carries `rustcrypto` in its feature list.
  Nothing else about the dependency is changed.

```powershell
./bin/setup.ps1                 # prerequisites, pinned idevice, idevice-tools, npm ci, bridge
node bin/prepare-device.mjs     # developer mode, then the developer disk image
node bin/call.mjs poki_mcp_status
```

## Using the phone over the network

Being on the same network is not enough. usbmuxd finds a phone over Wi-Fi only when the
phone advertises `_apple-mobdev2._tcp`, which it does only after this host is allowed to
connect over Wi-Fi. That permission lives on the device, and the only way to set it is a
lockdown session — so the cable is needed exactly once:

```powershell
# with the iPhone connected over USB and unlocked
python -m pymobiledevice3 lockdown wifi-connections on      # was false
node bin/prepare-remote.mjs <UDID> <phone-lan-ip>            # RemotePairing pairing file
```

After that the cable can come out. `remote.mjs` drives the helper over its stdio form on
Windows, because the Unix domain socket the macOS path uses does not exist here; one
helper stays resident per pairing file, so the tunnel is built once rather than per call.
Measured over the iPhone's own hotspot (172.20.10.0/24), cable removed:

| Call | Cold | Note |
| --- | --- | --- |
| `take_screenshot` | 5.7 s | includes the RemotePairing tunnel |
| `list_elements` | 2.8 s | 20 elements, accessibility source |

Two things to know when it does not appear:

* `pymobiledevice3 doctor` reports `Bonjour discovery: queries left the host on 2 of 41
  interface(s)`. A machine with WSL, Hyper-V, VPN adapters and Bluetooth networking has
  many interfaces, and mDNS can leave through the wrong one. If the phone still does not
  appear, that is the first thing to look at.
* `Pairing: 0 own, 0 RemotePairing` means no pairing file exists yet, and the cellular
  path cannot work without one. `remote pair` is for Apple TV-style pin pairing; a
  standard iPhone gets its file from `bin/prepare-remote.mjs` over USB.

## What the phone still needs

Both of these are the phone's, not the host's:

1. **Developer Mode.** `idevice-tools amfi status` reports `Enabled: false` until a
   person turns it on. `amfi show` only reveals the switch; `amfi enable` refuses with
   `UnknownErrorType("Device has a passcode set")`, so the switch has to be flipped by
   hand in Settings → Privacy & Security → Developer Mode, followed by a restart.
   UI Automation has to be on in Developer Settings as well.
2. **The developer disk image.** iOS 17+ ships it as a cryptex. `cryptexd list` says
   `no cryptexes installed` on a fresh phone, and until it is installed the CoreDevice
   tunnel connects but every service is missing:

   ```
   $ printf '{"op":"display_info"}' | build/poki-native.exe --udid <udid>
   {"error":"service not found","screen_change_verified":false}
   ```

   Two ways to get one, in order of reliability:

   * `POKI_DDI_DIR=<path> node bin/prepare-device.mjs` where `<path>` is an unpacked
     `iOS_DDI/Restore` directory copied from a Mac whose Xcode matches the iOS version.
     This is exactly what the macOS build does with `cryptexd install-ddi`.
   * `node bin/prepare-device.mjs` with no `POKI_DDI_DIR`: it asks
     `pymobiledevice3 mounter auto-mount` to download and personalize one.

   Success is `com.apple.coredevice.displayservice` appearing in `idevice-tools remotexpc`.

## Where things live

| What | macOS | Windows |
| --- | --- | --- |
| State, token, frames | `~/Library/Application Support/PokiMCP` | `%LOCALAPPDATA%\PokiMCP` |
| Recordings | `~/Movies/Poki MCP` | `%USERPROFILE%\Videos\Poki MCP` |
| Screenshots | `~/Pictures/Poki MCP` | `%USERPROFILE%\Pictures\Poki MCP` |
| Device tools | `.deps/idevice/target/release/idevice-tools` | same, with `.exe` |
| Bridge | `build/poki-native` | `build\poki-native.exe` |

`src/os.mjs` holds every one of those decisions, so nothing else in the tree tests
the platform directly.

## What changed, file by file

| File | Change |
| --- | --- |
| `src/os.mjs` | New. `isWin`, `exe`, `python`, `owned`, `killTree`, `mediaDirectory`, `applicationData`. |
| `src/config.mjs` | State directory per platform; `nativeBin`, `simulatorBin` and the OCR executor are exported instead of being rebuilt at each call site. |
| `src/plist.mjs` | New. A binary and XML property-list reader, because `plutil` is macOS-only and an `.ipa` carries a binary `Info.plist`. |
| `src/work.mjs` | `killTree` instead of `process.kill(-pid)`; `windowsHide`; **`signal` is no longer handed to `execFile`** — see below. |
| `native/devices.py` | Unix socket on Unix, `127.0.0.1:27015` elsewhere, `USBMUXD_SOCKET_ADDRESS` honoured. |
| `src/device.mjs` | Uses `python`, `nativeBin` and the platform OCR executor. |
| `src/platform.mjs` | Simulator inventory, `devicectl`, `ditto`, `plutil`, `xcodebuild`, `atos` and app containers are gated; `.ipa` work uses `tar` and `src/plist.mjs`; `terminate_app` uses `app_service processes`/`signal`; crashes use `crash_logs`. |
| `src/recording.mjs` | Media directory per platform, owned spawns, `killTree`. |
| `src/human.mjs` | The approval dialog is a `WScript.Shell` message box on Windows instead of `osascript`. |
| `src/tools.mjs` | `start_simulator`, `shut_down_simulator`, `build_and_run` and `download_app_container` are not listed where Xcode does not exist, so the catalog is 52 tools instead of 56. |
| `src/daemon.mjs` | Also stops on `SIGHUP`, `SIGBREAK` and `SIGQUIT`; Windows delivers no `SIGTERM` to a console process. |
| `src/build-info.mjs` | Tracks the bridge by its real per-platform name. |
| `bin/build-native.mjs` | New. Cross-platform replacement for `bin/build-native`. |
| `bin/setup.ps1` | New. Windows installer and builder. |
| `bin/prepare-device.mjs` | Reports developer-mode state, then installs the DDI from `POKI_DDI_DIR` or `pymobiledevice3`. |
| `native/ocr_win.py` | New. Vision is macOS-only; this reproduces its exact contract with RapidOCR, falling back to `Windows.Media.Ocr`. |

### The orphaned helper

`execute()` used to pass its abort signal into `execFile`. Node's own abort handling
then killed *the child it started* — the leader of the tree — and everything that
helper had launched was orphaned. On macOS the process group covered for it; on
Windows nothing did, and every cancelled call left a `poki-native.exe` behind
(35 orphans after one test run). The signal is now handled by the `abort` listener
alone, which ends the tree with `taskkill /T /F`, and the leak is gone on both
platforms.

## Tools that cannot exist here

| Tool | Why |
| --- | --- |
| `start_simulator`, `shut_down_simulator` | CoreSimulator is part of Xcode. |
| `build_and_run` | `xcodebuild`. |
| `download_app_container` | `devicectl device copy from`, and the `.xcappdata` wrapper plist. |
| `open_url` | `devicectl device process openURL`. Typing the address into Safari with `type_text` does the same thing. |
| Crash symbolication | `atos` and `dwarfdump`. Crash reports are still listed and copied. |
| Wireless devices | The pairing records and mDNS discovery path here are macOS-specific; USB is what was verified. |

## OCR

`interaction.mjs` runs OCR whenever accessibility misses, and pools the screen after
every input, so a recognizer that takes seconds is a functional problem: the five
second patience window would expire before the answer arrived. `native/ocr_win.py`
prints the same JSON an `ocr.swift` build does — `{text, confidence, x, y, width,
height}` in the pixels of the image it was given.

### One engine is enough, and it took three measurements to find it

Measured on a 1320×2868 device capture of one screen, ten runs, same process:

| Engine | Median | Lines | Strings right (of 7) |
| --- | --- | --- | --- |
| `Windows.Media.Ocr` | 203 ms | 43 | 5 |
| PP-OCRv6 **tiny**, onnxruntime on the CPU | 1054 ms | 44 | **7** |
| PP-OCRv6 tiny, **onnxruntime-directml** | **202 ms** | 44 | **7** |
| PP-OCRv6 small, onnxruntime-directml | 350 ms | 40 | 7 |
| PP-OCRv6 tiny, OpenVINO on the CPU | 1186 ms | 44 | 7 |

The seven strings were read off the screenshot by eye: the status bar time, the chat
title with its unread count, the search placeholder, an "official accounts" row, a
preview line, a group name with less common characters, and a row timestamp. Windows
OCR got `公众号` and `下午 4:56` wrong, and it is the one that splits Chinese into single
characters; the same model on the CPU was accurate but five times slower.

**DirectML is what made one engine possible.** It runs the same ONNX graphs on the GPU,
so the accurate engine became the fast one too — 202 ms and 7 of 7, against 203 ms and
5 of 7 for the system recognizer. OpenVINO, on the other hand, was slower than the CPU
build for both model sizes on this Intel Core Ultra 9, so it is not used.

`native/ocr_win.py` therefore asks for `rapidocr` first, puts it on the GPU when
`DmlExecutionProvider` is available, and falls back to `Windows.Media.OCR` only if that
cannot load. One child process stays resident and answers one JSON array per image path.

Detection resolution barely matters past 960 (the point at which the recognizer's crops
stop gaining detail), and 736 loses a row: 976 ms and 6 of 7 there, 1083 ms and 7 of 7 at
960, 1500 ms and 7 of 7 at 1600.

```powershell
python -m pip install winsdk rapidocr onnxruntime-directml --index-url https://pypi.org/simple
# Without onnxruntime-directml the same model still works on the CPU, about five times slower.
$env:POKI_OCR_ENGINE = 'rapidocr'    # or 'windows', or 'auto' (default)
```

### Read the capture, not the reduced frame

`readOCR` recognizes the original device capture and divides the coordinates back by
the frame's scale. Recognizing the frame already reduced to points loses the strokes
that separate one Chinese character from another, and the loss is measurable: on the
same screen, `Windows.Media.Ocr` found **28 lines from the points frame and 43 from the
original**, and that is where `窦` had been read as `室`.

### Choosing an engine by hand

```powershell
python -m pip install winsdk rapidocr --index-url https://pypi.org/simple
$env:POKI_OCR_ENGINE = 'windows'    # or 'rapidocr'
```

### Spaces between Chinese characters

A recognizer may put a space after every character it reads, and Windows OCR also does
it inside numbers and around punctuation (`微信 ( 714 )`). A caller never writes those
spaces, so `normalize()` drops all whitespace from a string that contains CJK before
matching; a Latin-only string keeps its word boundaries.

## Speed: where the milliseconds actually go

Every tool reply carries `_meta.timing.stages`, so this is measured rather than guessed.
`test/probes/perf-probe.mjs` prints them for a screenshot, an element read, OCR and a tap.

Before the OCR work, on the same phone:

```
take_screenshot          7770 ms   of which ocr 6384 ms
list_elements (ax)       2231 ms
list_elements (ocr)      5459 ms   of which ocr 4608 ms
tap                      5880 ms
```

After:

```
take_screenshot          1282 ms   of which ocr 288 ms
list_elements (ax)       1637 ms
list_elements (ocr)       407 ms   of which ocr   7 ms (resident, warm)
tap                      8038 ms
```

What the rest is, and what does not help:

* **An element read is ~1.1 s of device time**, not host time. `display_info` over the
  same tunnel answers in 124–142 ms warm, so building the CoreDevice tunnel costs about
  120 ms; the accessibility walk is the device doing the work. A resident bridge would
  therefore save a few hundred milliseconds per action, not seconds — it is the last
  thing worth doing, not the first.
* **A tap carries a fixed one second sleep** (`main.rs`, after the media stream opens,
  so the device is ready for touches). It is in the upstream design and is the same on
  macOS.
* **The `rustcrypto` TLS backend is not in this path.** `CoreDeviceProxy` tunnels
  plain bytes over usbmuxd; the TLS client only matters for remote pairing. Swapping to
  `aws-lc` would not make actions faster, and on this host it cannot be built anyway
  without the MSVC C++ workload.
* **Defender scanning is not measurable here** — process startup for both helpers is
  about 18 ms — but adding the checkout to the exclusion list still needs an
  administrator, which this shell is not. If a machine with admin shows slow spawns,
  that is the first thing to exclude:
  `Add-MpPreference -ExclusionPath <checkout>`.

## Tests

`test/fixture.mjs` fakes external programs by writing scripts onto `PATH`. POSIX runs
them through a shebang; Windows cannot execute a file that way. `test/shim.c` compiles
to a launcher that runs the sibling `<name>.mjs` under node, and the fixture copies it
under each faked name. `node_modules` is linked with a junction, which needs no
privilege, and the code that watches the bridge edits the launcher's sibling script
while touching the launcher so its build marker moves.

```
node --test test/protocol.test.mjs      -> 14 pass, 0 fail, 2 skipped
node --test test/coordination.test.mjs  -> 63 pass, 0 fail, 41 skipped
```

The skips are `{ skip: <reason> }` with the reason attached, never a silently dropped
test: 34 need the iOS Simulator, 5 need the recording rig that was built around POSIX
process semantics, 1 needs the macOS approval dialog, 1 needs `devicectl`.

Two Windows facts the assertions had to learn:

* `(await stat(file)).mode & 0o777` is meaningless; Windows carries access as ACLs.
* `process.kill(pid, 0)` still succeeds for a terminated process whose object has open
  handles, so liveness is answered from the process table instead
  (`processGone()` in `test/fixture.mjs`).
