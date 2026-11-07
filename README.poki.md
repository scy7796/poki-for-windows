<p align="center">
  <img src="docs/images/poki-icon.png" width="72" height="72" alt="Poki icon">
</p>

<h1 align="center">Poki uses your iPhone like you do</h1>

<p align="center">
  <img src="docs/images/poki-home.gif" width="720" alt="Poki website home page animation">
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.es.md">Español</a><br>
  <a href="https://poki.bot">poki.bot</a>
</p>

<!-- badges:start -->
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" alt="License: AGPL-3.0-only"></a>
  <a href="https://github.com/JosssphZhou/poki/stargazers"><img src="https://img.shields.io/github/stars/JosssphZhou/poki" alt="GitHub stars"></a>
  <a href="https://github.com/JosssphZhou/poki/forks"><img src="https://img.shields.io/github/forks/JosssphZhou/poki" alt="GitHub forks"></a>
  <a href="https://github.com/JosssphZhou/poki/issues"><img src="https://img.shields.io/github/issues/JosssphZhou/poki" alt="GitHub issues"></a>
  <a href="https://github.com/JosssphZhou/poki/releases"><img src="https://img.shields.io/github/v/release/JosssphZhou/poki" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20iOS-lightgrey" alt="Platform: macOS and iOS">
</p>
<!-- badges:end -->

## Quick start

**Let your agent install it.** Copy this to your agent:

```text
Install https://github.com/JosssphZhou/poki following its root AGENTS.md, including the MCP skill, and stop whenever you need me to act.
```

**Poki MCP.** Already using Claude Code, Codex, or another MCP client? Connect Poki MCP and use your own subscription. No extra model account needed.

Start the server and keep it running:

```sh
git clone https://github.com/JosssphZhou/poki.git
cd poki
./bin/setup
npm start
```

Requires macOS 15 or later, full Xcode, Rust, Node.js 24+, and ffmpeg. `./bin/setup` checks for missing dependencies. The initial build takes a few minutes.

### Prebuilt macOS arm64 package

Download `poki-v0.1.1-macos-arm64.tar.gz` from the release and run:

```sh
tar -xzf poki-v0.1.1-macos-arm64.tar.gz
cd poki-v0.1.1
npm ci --no-audit --no-fund
npm start
```

The package includes the native bridge and idevice tools. You do not need Rust or `./bin/setup`. You still need macOS on Apple Silicon, full Xcode, Node.js 24+, Python 3, and ffmpeg. Register your MCP client and install the optional Agent as described below.

In another terminal, from the same directory, register the MCP server:

```sh
claude mcp add --scope user poki-mcp -- node "$PWD/src/stdio.mjs"   # Claude Code
codex mcp add poki-mcp -- node "$PWD/src/stdio.mjs"                 # Codex
```

**Poki Agent.** For Poki's standalone terminal agent or messaging channels, keep `npm start` running and open another terminal in the same directory. Install the agent, add its command to this terminal's path, and sign in:

```sh
npm ci --prefix agent
export PATH="$PWD/bin:$PATH"
poki login
poki status
```

Poki Agent uses GPT-6.1 Terra (`gpt-6.1-terra`) with low reasoning by default. We recommend keeping it: it is the fastest setup we have tested for phone tasks. Override it with `POKI_AGENT_MODEL`; see [Run Poki Agent](agent/README.md).

For a physical iPhone, pair it with your Mac over USB first. See [Physical iPhone setup](docs/physical-iphone.md).

Update with `./bin/poki update`. Set `POKI_NO_UPDATE_CHECK=1` to disable the daily anonymous GitHub release check. See [Update](AGENTS.md#update) for the request URL, restart steps, and prebuilt packages.

## Try a task

With Poki Agent, one connected iPhone is selected automatically. With multiple devices, add `--device '<device UUID>'`.

```sh
node bin/call.mjs list_devices   # Find your device UUID
poki "Search esp32 in Chrome and summarize the top result"
```

> **Note:** Poki controls your real iPhone. If you ask it to send messages or make payments, it will. Screen contents are sent to your configured model service.

Gets faster with use: Poki Agent remembers past tasks and runs them faster on repeat.

**Channels:** After configuring an authorized channel, start it with `poki imessage` or `poki telegram`. See [Poki Agent](agent/README.md) for setup.

**MCP clients:** Claude Code, Codex, and any client supporting `mcpServers` JSON.

Physical iPhone support has been verified only on iPhones using the Chinese interface. Physical devices support portrait orientation only. App container export and direct links to Settings subpages are unavailable. See [verification and known limits](docs/verification.md).

## Docs

| Topic | Read |
| --- | --- |
| Installation, other MCP clients, and troubleshooting | [Install guide](docs/install.md) |
| Poki Agent, models, iMessage, and Telegram | [Run Poki Agent](agent/README.md) |
| MCP tool reference | [Tool behavior](docs/tools.md) |
| Environment variables and sessions | [Configuration](docs/configuration.md) |
| USB pairing, Developer Mode, and Wi-Fi | [Physical iPhone setup](docs/physical-iphone.md) |
| Test results, known limits, and disclaimers | [Verification](docs/verification.md) |
| Bridge architecture | [Native bridge](native/NATIVE.md) and [simulator adapter](native/simulator.md) |
| Roadmap | [poki.bot](https://poki.bot) |

## Roadmap

<p align="center">
  <img src="docs/images/roadmap.png" width="860" alt="Poki roadmap. Shipped: Poki MCP, Poki Agent, iMessage and Terminal integrations, self-learning routes. In Progress: remote connections (no shared LAN required), Telegram integration, native text input (clipboard-free), persistent connection performance improvements, simplified tool interface. Planned: Poki App, which runs locally on iPhone and is available while your Mac is powered off. Future: iPhone Duo support, physical device support (no Xcode required), additional model providers.">
</p>

## Star History

<a href="https://www.star-history.com/?repos=JosssphZhou%2Fpoki&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&theme=dark&legend=top-left">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&legend=top-left">
    <img alt="Star History chart" src="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&legend=top-left">
  </picture>
</a>

## Contributors

<a href="https://github.com/JosssphZhou/poki/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=JosssphZhou/poki" alt="Contributors">
</a>

## Disclaimer

Poki is an independent open source project. It is not affiliated with, or endorsed by, Apple, OpenAI, or the makers of any app or website it operates. iPhone is a trademark of Apple Inc.

Automating third-party apps and websites may violate their terms of service. Decide for yourself whether to use Poki with a given service. You are responsible for what it does on your device and accounts, including messages it sends, changes it makes, and any account restrictions that result.

Poki is provided "as is", without warranty, as set out in the AGPL-3.0 license.

## License

Poki is open source under the [AGPL-3.0-only license](LICENSE).

Copyright (c) 2026 Joseph Zhou and contributors. Open-source dependencies retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgments

<p align="center">
  <img src="docs/images/acknowledgments.png" width="860" alt="Built on open source: pi, idevice, idb, BlueBubbles, Hermes Agent, MCP SDK, sharp, and FFmpeg"><br>
  <sub>Open source acknowledgments: <a href="https://github.com/earendil-works/pi">pi</a> | <a href="https://github.com/jkcoxson/idevice">idevice</a> | <a href="https://github.com/facebook/idb">idb</a> | <a href="https://github.com/BlueBubblesApp/bluebubbles-server">BlueBubbles</a> | <a href="https://github.com/NousResearch/hermes-agent">Hermes Agent</a> | <a href="https://github.com/modelcontextprotocol/typescript-sdk">MCP SDK</a> | <a href="https://github.com/lovell/sharp">sharp</a> | <a href="https://github.com/FFmpeg/FFmpeg">FFmpeg</a></sub>
</p>
