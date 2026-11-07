<p align="center">
  <img src="docs/images/poki-icon.png" width="72" height="72" alt="Poki icon">
</p>

<h1 align="center">Poki for Windows</h1>

<p align="center">
  Drive a real iPhone from a Windows PC through MCP: screenshots, the accessibility tree, OCR, taps, typing and swipes.<br>
  A community port of <a href="https://github.com/JosssphZhou/poki">Poki</a> v0.1.1, which targets macOS.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" alt="License: AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/host-Windows%2011-0078D4" alt="Host: Windows 11">
  <img src="https://img.shields.io/badge/phone-iOS%2027-lightgrey" alt="Phone: iOS 27">
  <img src="https://img.shields.io/badge/tests-90%20pass%20%7C%200%20fail-brightgreen" alt="Tests: 90 pass, 0 fail">
</p>

Same MCP server, same tools, same Rust bridge as Poki. What changes is how the PC reaches the phone, where state lives, which OCR engine reads the screen, and which tools are left out because they need Xcode. You only need a Mac if pymobiledevice3 cannot download the developer disk image for your iOS version.

## Let your agent install it

Paste this into Claude Code, Codex, or any agent that can run PowerShell:

```text
Install https://github.com/scy7796/poki-for-windows following its root AGENTS.md, including the MCP skill, and stop whenever you need me to act.
```

[AGENTS.md](AGENTS.md) walks the agent through prerequisites, the build, starting the service, registering your MCP client, and pairing the iPhone. It stops and asks you for the parts only you can do on the phone: Trust This Computer, Developer Mode, UI Automation.

## Install it yourself

You need Windows 11, Git, Node.js 24+, Python 3.11+, Rust (rustup), ffmpeg, and the Apple Devices app from the Microsoft Store.

```powershell
git clone https://github.com/scy7796/poki-for-windows.git
cd poki-for-windows
./bin/setup.ps1
python -m pip install rapidocr onnxruntime-directml winsdk pymobiledevice3
```

Open the Apple Devices app (it runs the USB service on `127.0.0.1:27015`), plug in the iPhone, unlock it and tap Trust. Then:

```powershell
node bin/prepare-device.mjs      # checks Developer Mode, installs the developer disk image
npm start                        # keep this running
node bin/call.mjs list_devices   # in a second window
```

Register the server with your client, for example Claude Code:

```powershell
claude mcp add --scope user poki-mcp -- node "$PWD\src\stdio.mjs"
```

The full walkthrough, Wi-Fi setup included, is in [docs/windows.md](docs/windows.md).

## What was tested

All numbers below come from one Windows 11 PC (Intel Core Ultra 9) and one iPhone 16 Pro Max (iPhone17,2) on iOS 27.0.1. A different phone, iOS version, or network will give different timings.

| What | Result |
| --- | --- |
| `npm test` | 136 tests: 90 pass, 0 fail, 46 skipped. Every skip names its reason; 35 need the iOS Simulator, which only Xcode provides. |
| OCR, one 1320×2868 screenshot | 202 ms, 7 of 7 test strings read correctly (PP-OCRv6 on DirectML). Windows' built-in OCR took 203 ms and got 5 of 7. |
| `take_screenshot` over USB | 1282 ms, OCR included |
| `list_elements` over USB | 1637 ms from accessibility, 407 ms from OCR when accessibility is empty |
| `tap` over Wi-Fi (phone hotspot) | 6.4 to 7.0 s; 5 of 5 taps delivered |
| `take_screenshot` / `list_elements` over Wi-Fi | 5.7 s / 2.8 s, cold |

Where a 6.4 s tap goes: 1.7 s is the touch itself (opening the media session, a fixed one-second warm-up, the touch), and about 3.9 s is reading the screen before and after to confirm what changed. Pass `verify: false` to `tap`, `tap_text`, `swipe`, `scroll` or `batch_commands` to skip that check when you don't need it. The saving has not been timed on the phone yet.

From a real task log: setting up an iOS Shortcuts automation took 38 UI steps, and 30 went through. Of the 8 that failed, 3 were the service being restarted underneath the task, 2 were taps over Wi-Fi before the audio fix below, 1 was another app holding the microphone, 1 was a `tap_text` that gave up before OCR finished (its time limit has been fixed since), and 1 reported an error after the text had been typed.

## Known limits

- Over Wi-Fi the five test taps were on a static title, so they prove delivery, not that a control reacted. A tap that changes the screen has not been timed over the network.
- Any input fails with CoreDevice error 9022 while another app on the phone holds the microphone (a call, a voice note, a voice assistant). Free the microphone and it works again.
- Poki's resident helper, which keeps one media session per device, listens on a Unix socket and does not build on Windows. Every input here opens its own session and waits one second.
- `start_simulator`, `shut_down_simulator`, `build_and_run`, `download_app_container` and `open_url` need Xcode and are not offered. Crash reports are listed but not symbolicated.
- The developer disk image comes from pymobiledevice3's downloader, or from a Mac whose Xcode matches the phone's iOS version (`POKI_DDI_DIR`).
- Not tested on macOS. This fork builds the bridge with the `rustcrypto` TLS backend on every platform.

## Relationship to Poki

Poki is written by [Joseph Zhou](https://github.com/JosssphZhou) and contributors. This repository keeps its history and its AGPL-3.0-only license, and adds the Windows port on top of v0.1.1. The upstream README is kept as [README.poki.md](README.poki.md), and the port's design notes are in [docs/windows.md](docs/windows.md).

Problems that only happen on Windows belong here. Problems you can reproduce on a Mac belong upstream.
