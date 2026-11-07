<p align="center">
  <img src="docs/images/poki-icon.png" width="72" height="72" alt="Poki icon">
</p>

<h1 align="center">Poki for Windows</h1>

<p align="center">
  在 Windows 电脑上通过 MCP 操作真实的 iPhone：截图、读无障碍树、OCR、点击、打字、滑动。<br>
  <a href="https://github.com/JosssphZhou/poki">Poki</a> v0.1.1 的社区移植版，原版运行在 macOS 上。
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文<br>
  macOS 上的 Poki：<a href="https://poki.bot">poki.bot</a> · <a href="README.poki.zh-CN.md">原项目说明</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue" alt="License: AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/host-Windows%2011-0078D4" alt="Host: Windows 11">
  <img src="https://img.shields.io/badge/phone-iOS%2027-lightgrey" alt="Phone: iOS 27">
  <img src="https://img.shields.io/badge/tests-90%20pass%20%7C%200%20fail-brightgreen" alt="Tests: 90 pass, 0 fail">
</p>

MCP 服务、工具和 Rust 桥都和 Poki 一样。变的是电脑怎么连到手机、状态文件放在哪、用哪个 OCR 引擎读屏，以及去掉了几个离不开 Xcode 的工具。只有当 pymobiledevice3 下载不到你这个 iOS 版本的开发者磁盘映像时，才需要找一台 Mac。

## 让 agent 帮你装

把下面这句发给 Claude Code、Codex，或者任何能跑 PowerShell 的 agent：

```text
按 https://github.com/scy7796/poki-for-windows 根目录的 AGENTS.md 安装，包括 MCP skill，需要我动手的时候停下来告诉我。
```

[AGENTS.md](AGENTS.md) 会带着 agent 检查环境、编译、启动服务、注册 MCP 客户端、配对 iPhone。只有你能在手机上做的几步，它会停下来等你：信任此电脑、打开开发者模式、打开 UI Automation。

## 自己装

需要 Windows 11、Git、Node.js 24+、Python 3.11+、Rust（rustup），以及 Microsoft Store 里的 Apple Devices。ffmpeg 可装可不装，只有录屏用得到。

```powershell
git clone https://github.com/scy7796/poki-for-windows.git
cd poki-for-windows
./bin/setup.ps1
python -m pip install --upgrade rapidocr onnxruntime-directml pymobiledevice3
```

打开 Apple Devices（它会在 `127.0.0.1:27015` 上提供 USB 服务），插上 iPhone，解锁，点“信任”。然后：

```powershell
node bin/prepare-device.mjs      # 检查开发者模式，安装开发者磁盘映像
npm start                        # 保持运行
node bin/call.mjs list_devices   # 在另一个窗口里跑
```

再把服务注册到你的客户端，以 Claude Code 为例：

```powershell
claude mcp add --scope user poki-mcp -- node "$PWD\src\stdio.mjs"
```

完整步骤（包括 Wi-Fi 连接）见 [docs/windows.md](docs/windows.md)，英文。

## 实测结果

下面的数字都来自同一台 Windows 11 电脑（Intel Core Ultra 9）和同一台 iPhone 16 Pro Max（iPhone17,2，iOS 27.0.1）。换手机、换 iOS 版本、换网络，耗时都会不一样。

| 项目 | 结果 |
| --- | --- |
| `npm test` | 共 136 个：90 个通过，0 个失败，46 个跳过。每个跳过都写了原因，其中 35 个需要 iOS 模拟器，而模拟器只有 Xcode 才有。 |
| OCR，一张 1320×2868 的截图 | 202 ms，7 个测试字符串全部读对（PP-OCRv6，跑在 DirectML 上）。Windows 自带 OCR 用了 203 ms，读对 5 个。 |
| USB 下 `take_screenshot` | 1282 ms，含 OCR |
| USB 下 `list_elements` | 读无障碍树 1637 ms，无障碍树为空时改走 OCR，407 ms |
| Wi-Fi（手机热点）下 `tap` | 每次 6.4 到 7.0 s，5 次点击全部送达 |
| Wi-Fi 下 `take_screenshot` / `list_elements` | 5.7 s / 2.8 s，冷启动 |

一次 6.4 s 的点击，时间花在这几处：1.7 s 是触摸本身（建立媒体会话、固定的一秒预热、触摸），约 3.9 s 是点击前后各读一次屏幕，确认画面变了没有。用不着这一步确认时，给 `tap`、`tap_text`、`swipe`、`scroll` 或 `batch_commands` 传 `verify: false` 就能跳过。省下多少时间，还没在手机上测过。

一次真实任务的记录：在 iOS 快捷指令里设置一个自动化，共 38 步界面操作，成功 30 步。失败的 8 步里，3 步是任务进行中服务被重启，2 步是音频修复（音频流被拒后不再让输入失败）之前的 Wi-Fi 点击，1 步是别的 App 占着麦克风，1 步是 `tap_text` 没等 OCR 返回就放弃了（这个时限后来已经改了），还有 1 步是文字已经输进去了却报了错。

## 已知限制

- Wi-Fi 下那 5 次测试点击点在一个不会变的标题上，只能证明点击送到了，证明不了控件有反应。会让画面变化的点击，还没在网络连接下测过耗时。
- 手机上有别的 App 占着麦克风时（通话、语音消息、语音助手），所有输入都会报 CoreDevice 错误 9022。麦克风释放后就恢复。
- Poki 的常驻助手会给每台设备保持一个媒体会话，但它监听的是 Unix socket，在 Windows 上编译不过。所以这里每次输入都单独开一个会话，并等一秒。
- `start_simulator`、`shut_down_simulator`、`build_and_run`、`download_app_container` 和 `open_url` 离不开 Xcode，没有提供。崩溃报告能列出来，但不做符号化。
- 开发者磁盘映像来自 pymobiledevice3 的下载器，或者从一台 Mac 上拷过来，那台 Mac 的 Xcode 版本要和手机的 iOS 版本对应（`POKI_DDI_DIR`）。
- 没在 macOS 上测过。这个移植版在所有平台上都用 `rustcrypto` TLS 后端编译桥接程序。

## 隐私

- 服务只监听 `127.0.0.1`，每个请求都要带上 `%LOCALAPPDATA%\PokiMCP\mcp.json` 里的 token。这个文件夹里还有 Wi-Fi 配对记录和最近的画面帧，请像对待密码一样对待它。
- agent 调用工具时，Poki 会把截图、屏幕文字和无障碍树交给你的 MCP 客户端，再由客户端发给它所用的模型。所以手机屏幕上的任何内容，包括通知和验证码，都可能到达那家模型服务商。Poki 自己不往任何地方上传这些内容。
- 保存的截图默认放在 `Pictures\Poki MCP`，工具调用里指定了别的路径就放那里。
- 会联网的地方有四处。setup 从 GitHub、crates.io 和 npm 下载依赖，第一次跑 OCR 时从 modelscope.cn 下载模型，pymobiledevice3 会下载 Apple 的开发者磁盘映像。另外，服务每天会匿名向 GitHub API 查一次本仓库的最新版本，设置 `POKI_NO_UPDATE_CHECK=1` 可以关掉。

## 与 Poki 的关系

Poki 由 [Joseph Zhou](https://github.com/JosssphZhou)（X 上是 [@openmys](https://x.com/openmys)）和贡献者编写，官网是 [poki.bot](https://poki.bot)。本仓库保留了 Poki 的提交历史和 AGPL-3.0-only 许可证，在 v0.1.1 的基础上加了 Windows 移植。Poki 的维护者手上没有 Windows 机器可以测试，所以请这个移植版放在单独的仓库里维护，也就是这里。跟 Windows 无关的那个修复已经提回上游：[JosssphZhou/poki#39](https://github.com/JosssphZhou/poki/pull/39)。

Poki 原来的说明保留为 [README.poki.md](README.poki.md) 和各语言版本（`README.poki.zh-CN.md` 等）。移植的设计说明在 [docs/windows.md](docs/windows.md)。

只在 Windows 上出现的问题，请在这里提。在 Mac 上也能复现的问题，请提到上游。
