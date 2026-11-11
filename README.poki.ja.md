> これは macOS 向けの [Poki](https://github.com/JosssphZhou/poki) 本体の README です。このリポジトリの Windows 版については [README.md](README.md) をご覧ください。

<p align="center">
  <img src="docs/images/poki-icon.png" width="72" height="72" alt="Poki icon">
</p>

<h1 align="center">Poki は、あなたと同じように iPhone を使う</h1>

<p align="center">
  <img src="docs/images/poki-home.gif" width="720" alt="Poki 公式サイトのトップページのアニメーション">
</p>

<p align="center">
  <a href="README.poki.md">English</a> | <a href="README.poki.zh-CN.md">简体中文</a> | <a href="README.poki.zh-TW.md">繁體中文</a> | 日本語 | <a href="README.poki.ko.md">한국어</a> | <a href="README.poki.es.md">Español</a><br>
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

## クイックスタート

**iPhone に Poki App をインストールする。** [Alpha リリース](https://github.com/JosssphZhou/poki/releases/tag/app-alpha-latest)から Poki Setup をダウンロードし、画面の案内に従ってください。詳しくは [iPhone のインストール手順](README.md#poki-on-your-iphone)を参照してください。

**エージェントにインストールを任せる。** 次の内容をエージェントに渡してください：

```text
https://github.com/JosssphZhou/poki を、ルートの AGENTS.md に従ってインストールしてください。MCP スキルも含めます。私の操作が必要なときは、その都度止まってください。
```

**Poki MCP。** Claude Code、Codex などの MCP クライアントをすでに使っていますか？ Poki MCP を接続すれば、ご自身のサブスクリプションをそのまま使えます。追加のモデルアカウントは不要です。

サーバーを起動し、動かしたままにします：

```sh
git clone https://github.com/JosssphZhou/poki.git
cd poki
./bin/setup
npm start
```

macOS 15 以降、完全版の Xcode、Rust、Node.js 24+、ffmpeg が必要です。`./bin/setup` が不足している依存関係をチェックします。初回ビルドには数分かかります。

Poki は macOS 向けです。Linux では、コミュニティによる移植版 [poki-for-linux](https://github.com/carrotciallo/poki-for-linux)（[#16](https://github.com/JosssphZhou/poki/issues/16)）を参照してください。このリポジトリとは別に管理されています。

Windows: コミュニティによる移植版 [scy7796/poki-for-windows](https://github.com/scy7796/poki-for-windows)（作者が管理しており、当方ではテストしていません）。

### ビルド済み macOS arm64 パッケージ

リリースから `poki-v0.1.1-macos-arm64.tar.gz` をダウンロードして、次を実行します：

```sh
tar -xzf poki-v0.1.1-macos-arm64.tar.gz
cd poki-v0.1.1
npm ci --no-audit --no-fund
npm start
```

パッケージにはネイティブブリッジと idevice ツールが含まれています。Rust や `./bin/setup` は不要です。ただし、Apple Silicon の macOS、完全版の Xcode、Node.js 24+、Python 3、ffmpeg は必要です。MCP クライアントの登録と、オプションの Agent のインストールは下記のとおりです。

別のターミナルを同じディレクトリで開き、MCP サーバーを登録します：

```sh
claude mcp add --scope user poki-mcp -- node "$PWD/src/stdio.mjs"   # Claude Code
codex mcp add poki-mcp -- node "$PWD/src/stdio.mjs"                 # Codex
```

**Poki Agent。** Poki 単体のターミナルエージェントやメッセージングチャネルを使う場合は、`npm start` を動かしたまま、同じディレクトリで別のターミナルを開きます。エージェントをインストールし、そのコマンドをこのターミナルの PATH に追加して、サインインします：

```sh
npm ci --prefix agent
export PATH="$PWD/bin:$PATH"
poki login
poki status
```

Poki Agent は、デフォルトで GPT-6.1 Terra（`gpt-6.1-terra`）を推論強度 low で使用します。スマートフォンのタスクで私たちがテストした中で最も速い設定なので、そのまま使うことをおすすめします。モデルは `POKI_AGENT_MODEL` で変更できます。[Poki Agent の実行](agent/README.md)を参照してください。

実機の iPhone を使う場合は、先に USB で Mac とペアリングしてください。[実機 iPhone のセットアップ](docs/physical-iphone.md)を参照してください。

## タスクを試す

Poki Agent では、接続中の iPhone が 1 台なら自動で選択されます。複数台ある場合は `--device '<device UUID>'` を追加します。

```sh
node bin/call.mjs list_devices   # デバイスの UUID を確認
poki "Search esp32 in Chrome and summarize the top result"
```

> **注意：** Poki はあなたの実機 iPhone を操作します。メッセージの送信や支払いを頼めば、そのとおりに実行します。画面の内容は、設定したモデルサービスに送信されます。

使うほど速くなる：Poki Agent は過去のタスクを記憶し、繰り返し実行するときはより速く動きます。

**チャネル：** 許可済みのチャネルを設定したら、`poki imessage` または [`poki telegram`](agent/README.md#telegram) で起動します。設定方法は [Poki Agent](agent/README.md) を参照してください。

**MCP クライアント：** Claude Code、Codex、および `mcpServers` JSON に対応したクライアント。

実機 iPhone のサポートは、中国語インターフェースの iPhone でのみ検証済みです。実機は縦向きのみ対応です。App コンテナのエクスポートと、設定アプリのサブページへの直接リンクは使えません。[検証結果と既知の制限](docs/verification.md)を参照してください。

## ドキュメント

| トピック | 参照先 |
| --- | --- |
| インストール、その他の MCP クライアント、トラブルシューティング | [インストールガイド](docs/install.md) |
| Poki Agent、モデル、iMessage、Telegram | [Poki Agent を実行する](agent/README.md) |
| MCP ツールリファレンス | [ツールの動作](docs/tools.md) |
| 環境変数とセッション | [設定](docs/configuration.md) |
| USB ペアリング、デベロッパモード、Wi-Fi | [実機 iPhone のセットアップ](docs/physical-iphone.md) |
| テスト結果、既知の制限、免責事項 | [検証](docs/verification.md) |
| ブリッジのアーキテクチャ | [ネイティブブリッジ](native/NATIVE.md)と[シミュレータアダプタ](native/simulator.md) |
| ロードマップ | [poki.bot](https://poki.bot) |

## ロードマップ

<p align="center">
  <img src="docs/images/roadmap.png" width="860" alt="Poki roadmap. Shipped: Poki MCP, Poki Agent, iMessage, Telegram, and Terminal integrations, self-learning routes, remote connections. In Progress: persistent connection performance improvements, native text input (clipboard-free), simplified tool interface. Planned: Poki App, which runs locally on iPhone and is available while your Mac is powered off. Future: iPhone Duo support, physical device support (no Xcode required), additional model providers.">
</p>

- **リリース済み:** Poki MCP、Poki Agent、iMessage、Telegram とターミナルの連携、自己学習ルート、リモート接続
- **開発中:** **常時接続のパフォーマンス改善**、ネイティブテキスト入力（クリップボード不使用）、ツールインターフェースの簡素化
- **計画中:** Poki App：iPhone 上でローカル実行、Mac の電源がオフでも利用可能
- **将来の予定:** iPhone Duo のサポート、実機サポート（Xcode 不要）、対応モデルプロバイダーの追加

## Star History

<a href="https://www.star-history.com/?repos=JosssphZhou%2Fpoki&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&theme=dark&legend=top-left">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&legend=top-left">
    <img alt="Star History chart" src="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&legend=top-left">
  </picture>
</a>

## コアコントリビューター

<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/ZhehanZhang"><img src="https://avatars.githubusercontent.com/u/67270559?v=4&size=240" width="120" height="120" alt="ZhehanZhang"/><br /><sub><b>ZhehanZhang</b></sub></a><br />Poki の偉大な共同創造者。</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/igc110"><img src="https://avatars.githubusercontent.com/u/241411380?v=4&size=240" width="120" height="120" alt="igc110"/><br /><sub><b>igc110</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/10">#10</a> で実機 iPhone のタップが遅い原因を突き止め、その後の修正でタップが約 3 分の 1 速くなりました。</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/edge369"><img src="https://avatars.githubusercontent.com/u/63720633?v=4&size=240" width="120" height="120" alt="edge369"/><br /><sub><b>edge369</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/pull/14">#14</a> で Poki をルーター上で動かせるようにし、Mac の電源がオフでも Telegram から iPhone を操作できます。<a href="https://github.com/JosssphZhou/poki/pull/15">#15</a>、<a href="https://github.com/JosssphZhou/poki/pull/17">#17</a>、<a href="https://github.com/JosssphZhou/poki/issues/19">#19</a> が続きました。</td>
    </tr>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/carrotciallo"><img src="https://avatars.githubusercontent.com/u/69567867?v=4&size=240" width="120" height="120" alt="carrotciallo"/><br /><sub><b>carrotciallo</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/16">#16</a> で Poki を Linux に移植し、実機 iPhone で USB、LAN、Tailscale 経由の動作を確認しました。README はこの移植版を案内しています。</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/guangtouge82"><img src="https://avatars.githubusercontent.com/u/269691899?v=4&size=240" width="120" height="120" alt="guangtouge82"/><br /><sub><b>guangtouge82</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/18">#18</a> で実機 iPhone のタッチ失敗の原因が display service の欠如にあると突き止めました。Poki は何も送信されなかったことを伝え、prepare-device を案内します。</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/Dreaminmaster"><img src="https://avatars.githubusercontent.com/u/189544503?v=4&size=240" width="120" height="120" alt="Dreaminmaster"/><br /><sub><b>Dreaminmaster</b></sub></a><br />壊れたキャッシュ済みルートが無関係な Agent タスクを中断させる問題を修正し（<a href="https://github.com/JosssphZhou/poki/issues/21">#21</a>、<a href="https://github.com/JosssphZhou/poki/pull/22">#22</a>）、続く <a href="https://github.com/JosssphZhou/poki/pull/37">#37</a> で操作後に読み取った画面を Agent が再利用できるようにしました。</td>
    </tr>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/PeterKingXu1s"><img src="https://avatars.githubusercontent.com/u/89392314?v=4&size=240" width="120" height="120" alt="PeterKingXu1s"/><br /><sub><b>PeterKingXu1s</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/25">#25</a> で、自然言語の停止リクエストでは iMessage のタスクが止まらないことを報告しました。Poki はタスク中のメッセージに返信し、/stop を案内するようになりました。</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/ScottH1122"><img src="https://avatars.githubusercontent.com/u/142722955?v=4&size=240" width="120" height="120" alt="ScottH1122"/><br /><sub><b>ScottH1122</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/27">#27</a> と <a href="https://github.com/JosssphZhou/poki/issues/28">#28</a> で Agent のバグを 2 件再現しました。無効なコントロールがタップ対象になる問題と、一部失敗したバッチのトレースが失われる問題で、どちらも修正済みです。</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/jiahuipaung"><img src="https://avatars.githubusercontent.com/u/70688286?v=4&size=240" width="120" height="120" alt="jiahuipaung"/><br /><sub><b>jiahuipaung</b></sub></a><br />iPhone の LAN アドレスが変わると RemotePairing 接続が切れる問題（<a href="https://github.com/JosssphZhou/poki/issues/30">#30</a>）を <a href="https://github.com/JosssphZhou/poki/pull/34">#34</a> で修正しました。実機では 768 ミリ秒で再接続できました。</td>
    </tr>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/scy7796"><img src="https://avatars.githubusercontent.com/u/282529358?v=4&size=240" width="120" height="120" alt="scy7796"/><br /><sub><b>scy7796</b></sub></a><br />Windows ホストから RemotePairing 接続でタップが毎回失敗する問題を <a href="https://github.com/JosssphZhou/poki/pull/39">#39</a> で修正しました。修正後は 5 回中 5 回のタップが成功しました。</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/foshanfm"><img src="https://avatars.githubusercontent.com/u/24779370?v=4&size=240" width="120" height="120" alt="foshanfm"/><br /><sub><b>foshanfm</b></sub></a><br /><a href="https://github.com/JosssphZhou/poki/issues/42">#42</a> で Tailscale 経由の実機 iPhone を使い、保険約款の確認を行いました。この報告が、USB のより分かりやすいエラーと、セッションごとの接続方式の切り替えにつながっています。</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/xiaweiyi713"><img src="https://avatars.githubusercontent.com/u/208608622?v=4&size=240" width="120" height="120" alt="xiaweiyi713"/><br /><sub><b>xiaweiyi713</b></sub></a><br />Poki が実機 iPhone を操作するデモ動画を制作し、新しい訪問者がインストール前に何ができるかを確認できるようにしました。</td>
    </tr>
  </tbody>
</table>

## スペシャルサンクス

Issue や Pull Request を寄せてくださった皆さまに感謝いたします。皆さまのご報告と修正が Poki をより良くしています。

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

## 免責事項

Poki は独立したオープンソースプロジェクトです。Apple、OpenAI、および Poki が操作するアプリやウェブサイトの開発元とは提携関係になく、それらの承認も受けていません。iPhone は Apple Inc. の商標です。

サードパーティのアプリやウェブサイトの自動操作は、それらの利用規約に違反する可能性があります。特定のサービスで Poki を使うかどうかは、ご自身で判断してください。お使いのデバイスとアカウント上で Poki が行うこと（送信したメッセージ、加えた変更、その結果生じたアカウントの制限を含む）については、ご自身の責任となります。

Poki は AGPL-3.0 ライセンスの定めるとおり、無保証かつ「現状のまま」提供されます。

解釈に相違がある場合は、英語版が優先されます。

## ライセンス

Poki は [AGPL-3.0-only ライセンス](LICENSE)のもとでオープンソースとして公開されています。

Copyright (c) 2026 Joseph Zhou and contributors. オープンソースの依存関係には、それぞれのライセンスが適用されます。[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。コントリビュートについては [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。

## 謝辞

<p align="center">
  <img src="docs/images/acknowledgments.png" width="860" alt="オープンソースで構築：pi、idevice、idb、BlueBubbles、Hermes Agent、MCP SDK、sharp、FFmpeg"><br>
  <sub>オープンソースへの謝辞：<a href="https://github.com/earendil-works/pi">pi</a> | <a href="https://github.com/jkcoxson/idevice">idevice</a> | <a href="https://github.com/facebook/idb">idb</a> | <a href="https://github.com/BlueBubblesApp/bluebubbles-server">BlueBubbles</a> | <a href="https://github.com/NousResearch/hermes-agent">Hermes Agent</a> | <a href="https://github.com/modelcontextprotocol/typescript-sdk">MCP SDK</a> | <a href="https://github.com/lovell/sharp">sharp</a> | <a href="https://github.com/FFmpeg/FFmpeg">FFmpeg</a></sub>
</p>
