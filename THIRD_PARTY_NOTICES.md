# Open-source notices

The root AGPL-3.0-only license covers original Poki MCP contributions. Third-party code retains its respective copyright notices and license terms.

## idevice

Poki MCP uses [jkcoxson/idevice](https://github.com/jkcoxson/idevice) at commit `89702099f4d7552f704f93b4526756abda319ceb`, downloaded by setup into `.deps/idevice`. The upstream library and command-line tools are MIT licensed. The complete notice is retained in [native/bridge/LICENSE.idevice](native/bridge/LICENSE.idevice).

[native/bridge/src/stream.rs](native/bridge/src/stream.rs) adapts code from the pinned upstream [tools/src/coredevice_stream.rs](https://github.com/jkcoxson/idevice/blob/89702099f4d7552f704f93b4526756abda319ceb/tools/src/coredevice_stream.rs). The rest of the bridge calls upstream protocol APIs. The pinned [upstream license](https://github.com/jkcoxson/idevice/blob/89702099f4d7552f704f93b4526756abda319ceb/LICENSE.txt) remains applicable to that code.

PokiLauncher ([native/launcher](native/launcher)), which the iPhone app links, builds against the same idevice revision with [native/patches/idevice-xctest-run-over-rsd.patch](native/patches/idevice-xctest-run-over-rsd.patch) applied. The patch adds `run_over_rsd` to `idevice/src/services/dvt/xctest/mod.rs`; it adapts the steps of upstream `XCUITestService::run` in the same file to an RSD tunnel the caller already holds. The pinned upstream MIT license applies to that code. [native/launcher/fetch-idevice.sh](native/launcher/fetch-idevice.sh) applies the patch to a separate copy in `.deps/idevice-launcher`, so setup's `.deps/idevice` stays unmodified.

[native/bridge/src/pasteboard.rs](native/bridge/src/pasteboard.rs) also references the pinned upstream [pasteboard service protocol](https://github.com/jkcoxson/idevice/blob/89702099f4d7552f704f93b4526756abda319ceb/idevice/src/services/core_device/pasteboard_service.rs). Poki builds the upstream `idevice-tools` and `idevice_id` executables during setup; their dependencies are listed separately from those of Poki's native bridge in the [dependency inventory](docs/third-party-dependencies.md).

## Meta idb

The simulator adapter's XPC, accessibility, and HID wire-format work references [facebook/idb](https://github.com/facebook/idb) at commit `5c1044388339006c798c5a6c3c267816e6808297`. The complete MIT notice is retained in [native/LICENSE.idb](native/LICENSE.idb).

Relevant protocol and interface references at that revision include:

- [SimulatorDigitizerHIDTransport.swift](https://github.com/facebook/idb/blob/5c1044388339006c798c5a6c3c267816e6808297/FBSimulatorControl/HID/SimulatorDigitizerHIDTransport.swift), for the digitizer service transport.
- [SimulatorIndigoHID.swift](https://github.com/facebook/idb/blob/5c1044388339006c798c5a6c3c267816e6808297/FBSimulatorControl/HID/SimulatorIndigoHID.swift) and [SimulatorPurpleHID.swift](https://github.com/facebook/idb/blob/5c1044388339006c798c5a6c3c267816e6808297/FBSimulatorControl/HID/SimulatorPurpleHID.swift), for event formats and workspace messages.
- [AccessibilityClient.m](https://github.com/facebook/idb/blob/5c1044388339006c798c5a6c3c267816e6808297/SimulatorFrameworkBridge/Runtime/AccessibilityClient.m) and [AXPTranslatorRequest.h](https://github.com/facebook/idb/blob/5c1044388339006c798c5a6c3c267816e6808297/PrivateHeaders/AccessibilityPlatformTranslation/AXPTranslatorRequest.h), for the accessibility transport and request interface.

Poki MCP's simulator helper is a local implementation using these protocol references. It does not bundle the idb executable or Apple frameworks. The idb license is retained to preserve attribution for the referenced implementation and interfaces.

## BlueBubbles Server

The optional `bin/setup-channels` command downloads the unmodified [BlueBubbles Server 1.9.12](https://github.com/BlueBubblesApp/bluebubbles-server/releases/tag/v1.9.12) release from BlueBubblesApp. BlueBubbles is licensed under Apache-2.0; its complete upstream license is retained in [docs/licenses/BlueBubbles-LICENSE](docs/licenses/BlueBubbles-LICENSE). Its packaged dependencies retain their respective notices. The installer pins the official release asset's SHA-256 digest and preserves the app bundle, including its third-party notices. The application archive is not stored in this repository.

## Appium WebDriverAgent

The on-phone runner is built from [appium/WebDriverAgent](https://github.com/appium/WebDriverAgent) v16.15.3 (commit `02cb92f0e93c8b021443bcbb8eeb80932c113220`), vendored as a git submodule at [native/ios-runner/WebDriverAgent](native/ios-runner/WebDriverAgent). WebDriverAgent is BSD-3-Clause licensed (Copyright (c) 2015-present, Facebook, Inc.); its complete license is in the submodule's [LICENSE](https://github.com/appium/WebDriverAgent/blob/02cb92f0e93c8b021443bcbb8eeb80932c113220/LICENSE) and is shipped unchanged with the source. The submodule itself is not edited. Poki changes WebDriverAgent's code and the built runner app at build time, in three places:

- [native/ios-runner/patches/wda-poki-runner.patch](native/ios-runner/patches/wda-poki-runner.patch) modifies `WebDriverAgentRunner/UITestingUITests.m`. The runner's test starts WebDriverAgent's server only when the Poki launcher sets `POKI_LAUNCHER`, and while it runs it shows a "Poki is using this iPhone" screen. The build applies the patch before `xcodebuild` (`.github/workflows/ios-runner.yml`). The file keeps its original copyright header.
- [native/ios-runner/host](native/ios-runner/host) builds PokiRunnerHost, a library that `install.sh` adds to the built runner app and loads before XCTRunner's own code. Opened by hand, the runner then starts no test and sends people to Poki.
- [native/ios-runner/branding](native/ios-runner/branding) replaces the built app's icon, display name and launch screen.

## WebRTC

The Poki app's Voice tab links Google's [WebRTC](https://webrtc.googlesource.com/src) through the unmodified prebuilt framework from [stasel/WebRTC](https://github.com/stasel/WebRTC) 155.0.0 (Swift Package Manager, `native/ios-app/project.yml`). WebRTC is BSD-3-Clause licensed (Copyright (c) 2011, The WebRTC project authors); its license and patent grant ship inside the framework (`WebRTC.xcframework/LICENSE`). The framework is downloaded at build time and not stored in this repository.

## JavaScript packages

The exact installed versions come from `package-lock.json`. These packages provide the MCP server/client transports, image processing and input validation:

| Repository | Packages and locked versions | License |
| --- | --- | --- |
| [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | `@modelcontextprotocol/client`, `core`, `server` 2.4.0; `@modelcontextprotocol/node` 2.1.2 | Package metadata declares Apache-2.0. The upstream license also retains MIT for contributions without relicensing consent; its complete text is preserved in [third_party/LICENSE.typescript-sdk](third_party/LICENSE.typescript-sdk). |
| [sharp](https://github.com/lovell/sharp/tree/e0624568686516209c434de2d3c0ef6688f0811d) | `sharp` and applicable `@img/sharp-*` packages 0.34.5 | Apache-2.0; full text in [third_party/LICENSE.sharp](third_party/LICENSE.sharp). |
| [Zod](https://github.com/colinhacks/zod/tree/b500a2ee95134f81d74da7911d7378dd2853d042) | `zod` 4.6.7 | MIT; full text in [third_party/LICENSE.zod](third_party/LICENSE.zod). |

The [dependency inventory](docs/third-party-dependencies.md#npm-packages) names every locked npm package, its source repository, declared license and platform conditions. It includes transitive packages such as Hono, EventSource, jose and cross-spawn.

## libvips and bundled image libraries

`npm ci` selects sharp's prebuilt packages for the installing machine. On macOS arm64, `@img/sharp-libvips-darwin-arm64` 1.2.4 supplies libvips 8.17.3 and its bundled image libraries. The package is distributed by [sharp-libvips at commit 20b5e899954907a3039d6e3d4c200aaa0ec52c4c](https://github.com/lovell/sharp-libvips/tree/20b5e899954907a3039d6e3d4c200aaa0ec52c4c), with LGPL-3.0-or-later package metadata. Its components retain their own licenses.

The upstream component notices are retained in [third_party/NOTICE.sharp-libvips.md](third_party/NOTICE.sharp-libvips.md). The [bundle inventory](docs/third-party-dependencies.md#image-libraries-in-the-macos-arm64-libvips-package) lists the versions reported by that package, source repositories and component terms. This includes libvips, libheif, libexif, librsvg, GLib, Pango, Cairo, FreeType, libpng, libwebp and the other reported libraries.

## Rust packages

The native bridge directly depends on [Tokio](https://github.com/tokio-rs/tokio), [Serde](https://github.com/serde-rs/serde), [serde_json](https://github.com/serde-rs/json), [rust-plist](https://github.com/ebarnard/rust-plist), [futures-util](https://github.com/rust-lang/futures-rs), [uuid](https://github.com/uuid-rs/uuid) and idevice. PokiLauncher directly depends on idevice (with the patch above), Tokio, Serde, serde_json and rust-plist, and the iPhone app ships it with its whole `aarch64-apple-ios` graph. Their licenses and those of every resolved normal/build dependency in the macOS arm64 graphs and the launcher's iOS graph are listed in the [Rust inventory](docs/third-party-dependencies.md#rust-packages). It identifies packages used by the bridge, the upstream tools, or both. Cryptographic and other bundled code retains the notices supplied by its owning crate; the combined AWS-LC, BoringSSL and OpenSSL terms from the checked `aws-lc-sys` packages are also retained in [third_party/LICENSE.aws-lc](third_party/LICENSE.aws-lc).

## iPhone app Live Activity

The iPhone app's Live Activity ([native/ios-app/Shared](native/ios-app/Shared), [native/ios-app/PokiWidgets/PokiWidgetsBundle.swift](native/ios-app/PokiWidgets/PokiWidgetsBundle.swift) and [native/ios-app/Poki/Activity/ActivityController.swift](native/ios-app/Poki/Activity/ActivityController.swift)) ports code from three projects. Each file names its source in its header.

- [Clarklevis1995/dsh-mobile](https://github.com/Clarklevis1995/dsh-mobile/tree/ebe19764a412e8b0505d156f5bb13b2fc23c3bd6) at commit `ebe19764`, copyright 2026 Chaofan Li, under the [MIT license](third_party/LICENSE.dsh-mobile): the widget's structure (`AgentLiveActivityWidget.swift`), the Allow and Deny intents with their bridge into the app (`AgentApprovalIntents.swift`), the latest-wins update worker, ordered operation tail and update policy (`AgentLiveActivityManager.swift`), and the attribute layout (`AgentActivityAttributes.swift`). Poki keys a decision by its approval id alone, keeps an App Group mailbox for intents that run outside the app, lets Deny run without authentication, and drops the iOS 16 compatibility layer and the localized label set.
- [onehumanbeing/esp32-iphone-agent](https://github.com/onehumanbeing/esp32-iphone-agent/tree/cc966294b96b18da9b04931ec96cab7962461c7f) at commit `cc966294`, copyright 2026 Henry Yuan, under the [MIT license](third_party/LICENSE.esp32-iphone-agent): the update token bucket (`ios/IPhoneAgent/App/LiveActivity.swift`) and the system-counted countdown (`ios/AgentActivity/AgentActivityWidget.swift`).
- [leepokai/Codync](https://github.com/leepokai/Codync/tree/848070df40b788601bd0ae6c720fa77d823ab60e) at commit `848070d`, copyright 2026 Po Kai Lee, under the [Apache License 2.0](third_party/LICENSE.codync) with its [NOTICE](third_party/NOTICE.codync): the phase spring and row transition (`apps/ios/Kit/Sources/CodyncKit/Design/Motion.swift`, `ActivityCards.swift`), interpolated text and the expanded island's corner margins (`apps/ios/Widgets/CodyncWidgets.swift`). Poki changed these files: it ported the snippets into its own views.

The app and the Live Activity draw their Latin text in [Geist](https://github.com/vercel/geist-font) 1.3.1 (Regular, Medium, SemiBold, Bold and Black, from the `geist` npm package), copyright 2023 Vercel in collaboration with basement.studio, under the SIL Open Font License 1.1. The fonts and their complete license are in [native/ios-app/Shared/Fonts](native/ios-app/Shared/Fonts) and are bundled in both the app and its widget extension.

## iPhone app chat

The iPhone app's chat, Poki details and model pages ([native/ios-app/Poki/Chat](native/ios-app/Poki/Chat)) port code from four projects. Each file names its source in its header.

- [GetStream/swiftui-iMessage-clone](https://github.com/GetStream/swiftui-iMessage-clone/tree/df114b4) at commit `df114b4`, by Stefan Blos: the header with the picture and name that opens the details (`MessageListHeader.swift`, `MessageListHeaderModifier.swift`) and the message field with its send button (`ComposerInputView.swift`). The repository has no license file.
- [Mackarous/ConversationUI](https://github.com/Mackarous/ConversationUI/tree/e77c69e) at commit `e77c69e`, copyright 2024 Andrew Mackarous, under the [MIT license](third_party/LICENSE.conversationui): the message bubble (`Sources/ConversationUI/MessageBubble.swift`).
- [exyte/Chat](https://github.com/exyte/Chat/tree/f382a14) at commit `f382a14`, copyright 2019 exyte, under the [MIT license](third_party/LICENSE.exyte-chat): the plus button in front of the field (`Sources/ExyteChat/Views/InputView/InputView.swift`) and the waveform bars (`Sources/ExyteChat/Views/Recording/RecordWaveform.swift`).
- [lhuanyu/OllamaMessage](https://github.com/lhuanyu/OllamaMessage/tree/c857a02) at commit `c857a02`, copyright 2023 Huanyu Luo, under the [MIT license](third_party/LICENSE.ollamamessage): the model row and the provider list (`DialogueSettingsView.swift`, `OllamaModelSelectionView.swift`).

The plan bubble's motion (`PlanMotion.swift`) uses the spring, duration and order parameters of four [Motion+](https://motion.dev/plus) examples for React (notifications-list, copy-button, todo-list, typewriter-change-content), rewritten in SwiftUI. The typing pace is Poki's own. No Motion+ file is included.

## iPhone app model loop

The chat's model loop (`native/ios-app/Poki/Chat/PiLoop.swift`) links two products of [xibbon/PiSwift](https://github.com/xibbon/PiSwift/tree/f8696524cf41ca0a7f42f5b230eafa443daececd) at commit `f869652`, a Swift port of Mario Zechner's pi-mono, copyright 2025 Mario Zechner, under the [MIT license](third_party/LICENSE.piswift): PiSwiftAgent (the agent loop) and PiSwiftAI (the model providers and the ChatGPT sign-in). They are a Swift package dependency, not copied files; PiSwift's own dependencies come with it through the package resolution: MacPaw/OpenAI and jamesrochabrun/SwiftAnthropic (MIT) and apple/swift-argument-parser (Apache-2.0).

The ChatGPT code sign-in in `ChatGPTLogin.swift` ports the device code flow of `@earendil-works/pi-ai` 1.5.0 (`dist/auth/oauth/openai-codex.js`), copyright Mario Zechner, MIT license, the same license text.

## External open-source tools

Setup and runtime invoke these separately installed tools. Their versions and build options are chosen by the installing environment.

| Repository | Use | License |
| --- | --- | --- |
| [Node.js](https://github.com/nodejs/node) | JavaScript runtime, Node.js 24 or newer | MIT and included third-party notices |
| [npm CLI](https://github.com/npm/cli) | Install locked JavaScript packages and run build scripts | Artistic-2.0 and included dependency notices |
| [Rust](https://github.com/rust-lang/rust), [Cargo](https://github.com/rust-lang/cargo) | Compile the native bridge and idevice tools | MIT OR Apache-2.0 and included third-party notices |
| [CPython](https://github.com/python/cpython) | Device discovery and the optional unlock script | PSF-2.0 and included third-party notices |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | Encode and inspect recordings with `ffmpeg` and `ffprobe` | LGPL-2.1-or-later by default; GPL and other terms depend on the installed build. Run `ffmpeg -L` for that build's terms. |
| [Git](https://github.com/git/git) | Download and check the pinned idevice checkout during setup | GPL-2.0-only and included third-party notices |

## Distribution scope

This repository contains source code and the retained notices above. Setup downloads npm packages and builds idevice locally. Precompiled dependency bundles and the external tools are not committed here. A binary distribution must also retain the notices and satisfy the terms of the components actually included in that distribution. Poki's AGPL-3.0-only license does not replace any component's license.

The prebuilt macOS package includes the native bridge, OCR and simulator helpers, the unlock helper, and idevice tools. See [idevice release build notes](third_party/idevice-release.md) for the diagnostic-path replacement, reproduction commands, and dependency installation boundary. Rust dependency license texts shipped with the binary package are under `third_party/rust-licenses/`.

## GitHub CLI update check

[src/update-check.mjs](src/update-check.mjs) ports the complete release-check flow (`CheckForUpdate`, `getLatestReleaseInfo`, `getStateEntry`, and `setStateEntry`) from [GitHub CLI v2.83.0](https://github.com/cli/cli/blob/152d328db80d4d4d7318c7700b6644ee827618a7/internal/update/update.go), copyright 2019 GitHub Inc., under the [MIT license](third_party/LICENSE.github-cli). The port uses JavaScript and JSON instead of Go and YAML. Poki adds an anonymous short-timeout request, silent failed-attempt caching, release-note summaries, and cached notices for noninteractive MCP clients. It omits GitHub CLI's extension updates and terminal/CI restrictions.

## all-contributors thanks wall

[bin/thanks-wall.mjs](bin/thanks-wall.mjs) adapts the list layout and marker injection (`chunk`, `formatLine`, `generateContributorsList`, `injectListBetweenTags`, the avatar block template, and `formatAvatarUrl`) from [all-contributors/cli](https://github.com/all-contributors/cli/tree/ea23f04fd76498dd7c21717d715119d337e54012/src/generate), copyright 2016 Kent C. Dodds, 2019 Jake Bolam, 2020 Maximilian Berkmann, under the [MIT license](third_party/LICENSE.all-contributors-cli). Poki reads issue and pull request authors through the GitHub CLI instead of a `.all-contributorsrc` file, drops contribution badges and the table footer, and fails when a README is missing its markers.

## Poki Setup (desktop/)

The desktop app and its core crate ([desktop/](desktop/), AGPL-3.0-only) are written in Rust and TypeScript against these works:

- **GSA sign-in and anisette protocol.** [desktop/core/src/apple/gsa.rs](desktop/core/src/apple/gsa.rs), [srp.rs](desktop/core/src/apple/srp.rs) and [anisette.rs](desktop/core/src/apple/anisette.rs) follow Apple's GrandSlam flow (SRP-6a with Apple's `noUsernameInX` variant, the `spd` and `et` decryption, 2FA, the anisette v3 provisioning session) as implemented in [SideStore/apple-private-apis](https://github.com/SideStore/apple-private-apis) (icloud-auth, omnisette; MPL-2.0) and [Dadoum/Sideloader](https://github.com/Dadoum/Sideloader) (GPL-3.0-only). No source is copied; the request and response shapes are the same because Apple's servers define them.
- **Developer portal.** [desktop/core/src/apple/portal.rs](desktop/core/src/apple/portal.rs) uses the `developerservices2` QH65B2 actions and parameters as documented by Sideloader's `developersession.d` (GPL-3.0-only) and [SideStore/AltSign](https://github.com/SideStore/AltSign) (AGPL-3.0).
- **Entitlement rule.** [desktop/core/src/sign/entitlements.rs](desktop/core/src/sign/entitlements.rs) applies AltSign's rule for merging a profile's entitlements with the app's (AGPL-3.0).
- **Signing.** [apple-codesign](https://github.com/indygreg/apple-platform-rs) 0.29 (MPL-2.0) signs bundles; Apple's corecrypto and ldid are not used or shipped.
- **Device.** [jkcoxson/idevice](https://github.com/jkcoxson/idevice) 0.1.68 (MIT) for usbmuxd, lockdown, AMFI, misagent, installation_proxy, house_arrest, the image mounter, syslog and crash reports.
- **Apple root certificate.** `desktop/core/certs/AppleRootCA.der` is Apple Inc.'s public root certificate, used only to pin TLS to Apple's hosts.
- **Type.** Geist by Vercel, SIL Open Font License 1.1 ([desktop/app/public/fonts/LICENSE-Geist.txt](desktop/app/public/fonts/LICENSE-Geist.txt)).
- **Shell.** [Tauri 2](https://tauri.app) (MIT/Apache-2.0) with its opener, dialog, clipboard-manager and log plugins; window-vibrancy (MIT); React (MIT); Vite (MIT). Rust crate licences are listed by `cargo license` in `desktop/`.
