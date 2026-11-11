> 이 문서는 macOS용 [Poki](https://github.com/JosssphZhou/poki) 원본 README입니다. 이 저장소의 Windows 버전은 [README.md](README.md)를 참고하세요.

<p align="center">
  <img src="docs/images/poki-icon.png" width="72" height="72" alt="Poki icon">
</p>

<h1 align="center">Poki는 당신의 iPhone을 당신처럼 씁니다</h1>

<p align="center">
  <img src="docs/images/poki-home.gif" width="720" alt="Poki 공식 웹사이트 홈페이지 애니메이션">
</p>

<p align="center">
  <a href="README.poki.md">English</a> | <a href="README.poki.zh-CN.md">简体中文</a> | <a href="README.poki.zh-TW.md">繁體中文</a> | <a href="README.poki.ja.md">日本語</a> | 한국어 | <a href="README.poki.es.md">Español</a><br>
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

## 빠른 시작

**iPhone에 Poki App 설치하기.** [Alpha 릴리스](https://github.com/JosssphZhou/poki/releases/tag/app-alpha-latest)에서 Poki Setup을 다운로드하고 창의 안내를 따르세요. 자세한 내용은 [iPhone 설치 안내](README.md#poki-on-your-iphone)를 참고하세요.

**에이전트에게 설치를 맡기세요.** 아래 내용을 복사해 에이전트에게 전달하세요:

```text
https://github.com/JosssphZhou/poki 를 루트의 AGENTS.md에 따라 MCP 스킬까지 포함해 설치해 줘. 내가 직접 해야 하는 단계가 나오면 그때마다 멈춰 줘.
```

**Poki MCP.** 이미 Claude Code, Codex 또는 다른 MCP 클라이언트를 쓰고 있나요? Poki MCP를 연결하면 사용 중인 구독을 그대로 쓸 수 있습니다. 별도의 모델 계정은 필요 없습니다.

서버를 시작하고 계속 실행해 두세요:

```sh
git clone https://github.com/JosssphZhou/poki.git
cd poki
./bin/setup
npm start
```

macOS 15 이상, 전체 버전 Xcode, Rust, Node.js 24+, ffmpeg가 필요합니다. `./bin/setup`이 누락된 의존성을 확인합니다. 첫 빌드에는 몇 분이 걸립니다.

Poki는 macOS용입니다. Linux에서는 커뮤니티 포팅 버전인 [poki-for-linux](https://github.com/carrotciallo/poki-for-linux)([#16](https://github.com/JosssphZhou/poki/issues/16))를 참고하세요. 이 저장소와 별도로 관리됩니다.

Windows: 커뮤니티 포팅 버전 [scy7796/poki-for-windows](https://github.com/scy7796/poki-for-windows)(작성자가 관리하며, 저희는 테스트하지 않았습니다).

### 사전 빌드된 macOS arm64 패키지

릴리스에서 `poki-v0.1.1-macos-arm64.tar.gz`를 내려받아 실행하세요:

```sh
tar -xzf poki-v0.1.1-macos-arm64.tar.gz
cd poki-v0.1.1
npm ci --no-audit --no-fund
npm start
```

패키지에는 네이티브 브리지와 idevice 도구가 포함되어 있습니다. Rust나 `./bin/setup`은 필요 없습니다. 다만 Apple Silicon macOS, 전체 버전 Xcode, Node.js 24+, Python 3, ffmpeg는 여전히 필요합니다. MCP 클라이언트 등록과 선택 사항인 Agent 설치는 아래를 참고하세요.

같은 디렉터리에서 다른 터미널을 열고 MCP 서버를 등록하세요:

```sh
claude mcp add --scope user poki-mcp -- node "$PWD/src/stdio.mjs"   # Claude Code
codex mcp add poki-mcp -- node "$PWD/src/stdio.mjs"                 # Codex
```

**Poki Agent.** Poki의 독립형 터미널 에이전트나 메시징 채널을 쓰려면 `npm start`를 계속 실행한 채 같은 디렉터리에서 다른 터미널을 여세요. 에이전트를 설치하고, 명령어를 이 터미널의 PATH에 추가한 뒤 로그인하세요:

```sh
npm ci --prefix agent
export PATH="$PWD/bin:$PATH"
poki login
poki status
```

Poki Agent는 기본적으로 GPT-6.1 Terra(`gpt-6.1-terra`)를 low 추론 강도로 사용합니다. 휴대폰 작업에서 저희가 테스트한 가장 빠른 설정이므로 그대로 사용하는 것을 권장합니다. `POKI_AGENT_MODEL`로 모델을 변경할 수 있습니다. [Poki Agent 실행](agent/README.md)을 참고하세요.

실제 iPhone을 쓰려면 먼저 USB로 Mac과 페어링하세요. [실제 iPhone 설정](docs/physical-iphone.md)을 참고하세요.

## 작업 실행해 보기

Poki Agent에서는 연결된 iPhone이 한 대면 자동으로 선택됩니다. 기기가 여러 대면 `--device '<device UUID>'`를 추가하세요.

```sh
node bin/call.mjs list_devices   # 기기 UUID 확인
poki "Search esp32 in Chrome and summarize the top result"
```

> **주의:** Poki는 실제 iPhone을 조작합니다. 메시지를 보내거나 결제하라고 하면 그대로 실행합니다. 화면 내용은 설정한 모델 서비스로 전송됩니다.

쓸수록 빨라집니다: Poki Agent는 지난 작업을 기억해 반복 실행할 때 더 빠르게 처리합니다.

**채널:** 승인된 채널을 설정한 뒤 `poki imessage` 또는 [`poki telegram`](agent/README.md#telegram)으로 시작하세요. 설정 방법은 [Poki Agent](agent/README.md)를 참고하세요.

**MCP 클라이언트:** Claude Code, Codex, 그리고 `mcpServers` JSON을 지원하는 모든 클라이언트.

실제 iPhone 지원은 중국어 인터페이스를 쓰는 iPhone에서만 검증되었습니다. 실제 기기는 세로 방향만 지원합니다. 앱 컨테이너 내보내기와 설정 하위 페이지로 바로 가는 링크는 사용할 수 없습니다. [검증 결과와 알려진 제한](docs/verification.md)을 참고하세요.

## 문서

| 주제 | 문서 |
| --- | --- |
| 설치, 기타 MCP 클라이언트, 문제 해결 | [설치 가이드](docs/install.md) |
| Poki Agent, 모델, iMessage, Telegram | [Poki Agent 실행](agent/README.md) |
| MCP 도구 참조 | [도구 동작](docs/tools.md) |
| 환경 변수와 세션 | [구성](docs/configuration.md) |
| USB 페어링, 개발자 모드, Wi-Fi | [실제 iPhone 설정](docs/physical-iphone.md) |
| 테스트 결과, 알려진 제한, 면책 조항 | [검증](docs/verification.md) |
| 브리지 아키텍처 | [네이티브 브리지](native/NATIVE.md) 및 [시뮬레이터 어댑터](native/simulator.md) |
| 로드맵 | [poki.bot](https://poki.bot) |

## 로드맵

<p align="center">
  <img src="docs/images/roadmap.png" width="860" alt="Poki roadmap. Shipped: Poki MCP, Poki Agent, iMessage, Telegram, and Terminal integrations, self-learning routes, remote connections. In Progress: persistent connection performance improvements, native text input (clipboard-free), simplified tool interface. Planned: Poki App, which runs locally on iPhone and is available while your Mac is powered off. Future: iPhone Duo support, physical device support (no Xcode required), additional model providers.">
</p>

- **출시됨:** Poki MCP, Poki Agent, iMessage, Telegram 및 터미널 통합, 자가 학습 경로, 원격 연결
- **개발 중:** **지속 연결 성능 개선**, 네이티브 텍스트 입력(클립보드 미사용), 도구 인터페이스 간소화
- **계획됨:** Poki App: iPhone에서 로컬 실행, Mac이 꺼져 있어도 사용 가능
- **향후 계획:** iPhone Duo 지원, 실기기 지원(Xcode 불필요), 모델 제공업체 추가

## Star History

<a href="https://www.star-history.com/?repos=JosssphZhou%2Fpoki&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&theme=dark&legend=top-left">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&legend=top-left">
    <img alt="Star History chart" src="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&legend=top-left">
  </picture>
</a>

## 핵심 기여자

<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/ZhehanZhang"><img src="https://avatars.githubusercontent.com/u/67270559?v=4&size=240" width="120" height="120" alt="ZhehanZhang"/><br /><sub><b>ZhehanZhang</b></sub></a><br />Poki의 위대한 공동 창작자.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/igc110"><img src="https://avatars.githubusercontent.com/u/241411380?v=4&size=240" width="120" height="120" alt="igc110"/><br /><sub><b>igc110</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/10">#10</a>에서 실제 iPhone의 탭이 느린 원인을 찾아냈고, 이후 수정으로 탭이 약 3분의 1 빨라졌습니다.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/edge369"><img src="https://avatars.githubusercontent.com/u/63720633?v=4&size=240" width="120" height="120" alt="edge369"/><br /><sub><b>edge369</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/pull/14">#14</a>에서 Poki를 라우터에서 실행할 수 있게 만들어 Mac이 꺼져 있어도 Telegram으로 iPhone을 조작할 수 있게 했고, <a href="https://github.com/JosssphZhou/poki/pull/15">#15</a>, <a href="https://github.com/JosssphZhou/poki/pull/17">#17</a>, <a href="https://github.com/JosssphZhou/poki/issues/19">#19</a>가 이어졌습니다.</td>
    </tr>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/carrotciallo"><img src="https://avatars.githubusercontent.com/u/69567867?v=4&size=240" width="120" height="120" alt="carrotciallo"/><br /><sub><b>carrotciallo</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/16">#16</a>에서 Poki를 Linux로 포팅해 실제 iPhone에서 USB, LAN, Tailscale 연결을 검증했고, README는 이 포팅 버전을 안내합니다.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/guangtouge82"><img src="https://avatars.githubusercontent.com/u/269691899?v=4&size=240" width="120" height="120" alt="guangtouge82"/><br /><sub><b>guangtouge82</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/18">#18</a>에서 실제 iPhone의 터치 실패 원인이 display service 누락임을 밝혀냈고, 이제 Poki는 아무것도 전송되지 않았다고 알리며 prepare-device를 안내합니다.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/Dreaminmaster"><img src="https://avatars.githubusercontent.com/u/189544503?v=4&size=240" width="120" height="120" alt="Dreaminmaster"/><br /><sub><b>Dreaminmaster</b></sub></a><br />손상된 캐시 경로가 관련 없는 Agent 작업을 중단시키는 문제를 고쳤고(<a href="https://github.com/JosssphZhou/poki/issues/21">#21</a>, <a href="https://github.com/JosssphZhou/poki/pull/22">#22</a>), 이어 <a href="https://github.com/JosssphZhou/poki/pull/37">#37</a>에서 Agent가 동작 후 읽은 화면을 재사용하게 했습니다.</td>
    </tr>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/PeterKingXu1s"><img src="https://avatars.githubusercontent.com/u/89392314?v=4&size=240" width="120" height="120" alt="PeterKingXu1s"/><br /><sub><b>PeterKingXu1s</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/25">#25</a>에서 자연어 중지 요청으로는 iMessage 작업이 멈추지 않는다고 보고했고, 이제 Poki는 작업 도중 받은 메시지에 답하며 /stop을 안내합니다.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/ScottH1122"><img src="https://avatars.githubusercontent.com/u/142722955?v=4&size=240" width="120" height="120" alt="ScottH1122"/><br /><sub><b>ScottH1122</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/27">#27</a>과 <a href="https://github.com/JosssphZhou/poki/issues/28">#28</a>에서 Agent 버그 두 건을 재현했습니다. 비활성 컨트롤이 탭 대상으로 제시되는 문제와 일부 실패한 배치의 추적 기록이 사라지는 문제이며, 둘 다 수정되었습니다.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/jiahuipaung"><img src="https://avatars.githubusercontent.com/u/70688286?v=4&size=240" width="120" height="120" alt="jiahuipaung"/><br /><sub><b>jiahuipaung</b></sub></a><br />iPhone의 LAN 주소가 바뀌면 끊기던 RemotePairing 연결(<a href="https://github.com/JosssphZhou/poki/issues/30">#30</a>)을 <a href="https://github.com/JosssphZhou/poki/pull/34">#34</a>에서 고쳤고, 실제 iPhone은 768ms 만에 다시 연결되었습니다.</td>
    </tr>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/scy7796"><img src="https://avatars.githubusercontent.com/u/282529358?v=4&size=240" width="120" height="120" alt="scy7796"/><br /><sub><b>scy7796</b></sub></a><br />Windows 호스트에서 RemotePairing으로 연결할 때 탭이 매번 실패하던 문제를 <a href="https://github.com/JosssphZhou/poki/pull/39">#39</a>에서 고쳤고, 수정 후 5번 중 5번의 탭이 성공했습니다.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/foshanfm"><img src="https://avatars.githubusercontent.com/u/24779370?v=4&size=240" width="120" height="120" alt="foshanfm"/><br /><sub><b>foshanfm</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/42">#42</a>에서 Tailscale로 연결한 실제 iPhone으로 보험 약관을 확인했고, 이 보고가 더 알기 쉬운 USB 오류와 세션별 연결 방식 전환 작업으로 이어졌습니다.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/xiaweiyi713"><img src="https://avatars.githubusercontent.com/u/208608622?v=4&size=240" width="120" height="120" alt="xiaweiyi713"/><br /><sub><b>xiaweiyi713</b></sub></a><br />Poki가 실제 iPhone을 조작하는 데모 영상을 제작해, 새 방문자가 설치하기 전에 무엇을 할 수 있는지 볼 수 있게 했습니다.</td>
    </tr>
  </tbody>
</table>

## 고마운 분들

Issue나 Pull Request를 남겨 주신 모든 분께 감사드리며, 여러분의 제보와 수정 덕분에 Poki가 더 좋아지고 있습니다.

<!-- THANKS-WALL:START -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="20%"><a href="https://github.com/ZhehanZhang"><img src="https://avatars.githubusercontent.com/u/67270559?v=4&size=160" width="80" height="80" alt="ZhehanZhang"/><br /><sub><b>ZhehanZhang</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/carrotciallo"><img src="https://avatars.githubusercontent.com/u/69567867?v=4&size=160" width="80" height="80" alt="carrotciallo"/><br /><sub><b>carrotciallo</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/Dreaminmaster"><img src="https://avatars.githubusercontent.com/u/189544503?v=4&size=160" width="80" height="80" alt="Dreaminmaster"/><br /><sub><b>Dreaminmaster</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/edge369"><img src="https://avatars.githubusercontent.com/u/63720633?v=4&size=160" width="80" height="80" alt="edge369"/><br /><sub><b>edge369</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/foshanfm"><img src="https://avatars.githubusercontent.com/u/24779370?v=4&size=160" width="80" height="80" alt="foshanfm"/><br /><sub><b>foshanfm</b></sub></a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="20%"><a href="https://github.com/guangtouge82"><img src="https://avatars.githubusercontent.com/u/269691899?v=4&size=160" width="80" height="80" alt="guangtouge82"/><br /><sub><b>guangtouge82</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/igc110"><img src="https://avatars.githubusercontent.com/u/241411380?v=4&size=160" width="80" height="80" alt="igc110"/><br /><sub><b>igc110</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/jiahuipaung"><img src="https://avatars.githubusercontent.com/u/70688286?v=4&size=160" width="80" height="80" alt="jiahuipaung"/><br /><sub><b>jiahuipaung</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/kilingzhang"><img src="https://avatars.githubusercontent.com/u/17439300?v=4&size=160" width="80" height="80" alt="kilingzhang"/><br /><sub><b>kilingzhang</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/makirqi-alt"><img src="https://avatars.githubusercontent.com/u/295395617?v=4&size=160" width="80" height="80" alt="makirqi-alt"/><br /><sub><b>makirqi-alt</b></sub></a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="20%"><a href="https://github.com/mawenhao1028"><img src="https://avatars.githubusercontent.com/u/70818670?v=4&size=160" width="80" height="80" alt="mawenhao1028"/><br /><sub><b>mawenhao1028</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/PeterKingXu1s"><img src="https://avatars.githubusercontent.com/u/89392314?v=4&size=160" width="80" height="80" alt="PeterKingXu1s"/><br /><sub><b>PeterKingXu1s</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/ScottH1122"><img src="https://avatars.githubusercontent.com/u/142722955?v=4&size=160" width="80" height="80" alt="ScottH1122"/><br /><sub><b>ScottH1122</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/scy7796"><img src="https://avatars.githubusercontent.com/u/282529358?v=4&size=160" width="80" height="80" alt="scy7796"/><br /><sub><b>scy7796</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/wanghao-SunSky"><img src="https://avatars.githubusercontent.com/u/73684879?v=4&size=160" width="80" height="80" alt="wanghao-SunSky"/><br /><sub><b>wanghao-SunSky</b></sub></a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="20%"><a href="https://github.com/windywendyday"><img src="https://avatars.githubusercontent.com/u/65647922?v=4&size=160" width="80" height="80" alt="windywendyday"/><br /><sub><b>windywendyday</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/xiaweiyi713"><img src="https://avatars.githubusercontent.com/u/208608622?v=4&size=160" width="80" height="80" alt="xiaweiyi713"/><br /><sub><b>xiaweiyi713</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/zcyoung2000"><img src="https://avatars.githubusercontent.com/u/62181891?v=4&size=160" width="80" height="80" alt="zcyoung2000"/><br /><sub><b>zcyoung2000</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/Zeno6898"><img src="https://avatars.githubusercontent.com/u/229920081?v=4&size=160" width="80" height="80" alt="Zeno6898"/><br /><sub><b>Zeno6898</b></sub></a></td>
      <td align="center" valign="top" width="20%"><a href="https://github.com/zqy5608"><img src="https://avatars.githubusercontent.com/u/14949471?v=4&size=160" width="80" height="80" alt="zqy5608"/><br /><sub><b>zqy5608</b></sub></a></td>
    </tr>
  </tbody>
</table>
<!-- THANKS-WALL:END -->

## 면책 조항

Poki는 독립적인 오픈소스 프로젝트입니다. Apple, OpenAI 또는 Poki가 조작하는 앱이나 웹사이트의 제작사와 제휴 관계가 없으며, 이들의 보증을 받지 않았습니다. iPhone은 Apple Inc.의 상표입니다.

타사 앱과 웹사이트를 자동으로 조작하면 해당 서비스 약관을 위반할 수 있습니다. 특정 서비스에서 Poki를 쓸지는 직접 판단하세요. 사용자의 기기와 계정에서 Poki가 하는 일(보낸 메시지, 변경한 내용, 그 결과로 생긴 계정 제한 포함)에 대한 책임은 사용자에게 있습니다.

Poki는 AGPL-3.0 라이선스에 명시된 대로 어떠한 보증도 없이 "있는 그대로" 제공됩니다.

해석에 차이가 있는 경우 영어판을 기준으로 합니다.

## 라이선스

Poki는 [AGPL-3.0-only 라이선스](LICENSE)에 따라 공개된 오픈소스입니다.

Copyright (c) 2026 Joseph Zhou and contributors. 오픈소스 의존성은 각자의 라이선스를 따릅니다. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요. 기여하려면 [CONTRIBUTING.md](CONTRIBUTING.md)를 읽어 보세요.

## 감사의 말

<p align="center">
  <img src="docs/images/acknowledgments.png" width="860" alt="오픈소스 기반: pi, idevice, idb, BlueBubbles, Hermes Agent, MCP SDK, sharp, FFmpeg"><br>
  <sub>오픈소스 감사의 말: <a href="https://github.com/earendil-works/pi">pi</a> | <a href="https://github.com/jkcoxson/idevice">idevice</a> | <a href="https://github.com/facebook/idb">idb</a> | <a href="https://github.com/BlueBubblesApp/bluebubbles-server">BlueBubbles</a> | <a href="https://github.com/NousResearch/hermes-agent">Hermes Agent</a> | <a href="https://github.com/modelcontextprotocol/typescript-sdk">MCP SDK</a> | <a href="https://github.com/lovell/sharp">sharp</a> | <a href="https://github.com/FFmpeg/FFmpeg">FFmpeg</a></sub>
</p>
