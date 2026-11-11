> Este es el README de [Poki](https://github.com/JosssphZhou/poki), que funciona en macOS. Para la versión de Windows de este repositorio, consulta [README.md](README.md).

<p align="center">
  <img src="docs/images/poki-icon.png" width="72" height="72" alt="Poki icon">
</p>

<h1 align="center">Poki usa tu iPhone como lo harías tú</h1>

<p align="center">
  <img src="docs/images/poki-home.gif" width="720" alt="Animación de la página de inicio del sitio web de Poki">
</p>

<p align="center">
  <a href="README.poki.md">English</a> | <a href="README.poki.zh-CN.md">简体中文</a> | <a href="README.poki.zh-TW.md">繁體中文</a> | <a href="README.poki.ja.md">日本語</a> | <a href="README.poki.ko.md">한국어</a> | Español<br>
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

## Inicio rápido

**Instala Poki App en tu iPhone.** Descarga Poki Setup desde la [versión Alpha](https://github.com/JosssphZhou/poki/releases/tag/app-alpha-latest) y sigue las instrucciones de su ventana. Consulta la [guía de instalación en iPhone](README.md#poki-on-your-iphone).

**Deja que tu agente lo instale.** Copia esto a tu agente:

```text
Instala https://github.com/JosssphZhou/poki siguiendo el AGENTS.md de la raíz, incluida la skill de MCP, y detente cada vez que necesites que yo haga algo.
```

**Poki MCP.** ¿Ya usas Claude Code, Codex u otro cliente MCP? Conecta Poki MCP y usa tu propia suscripción. No necesitas otra cuenta de modelos.

Inicia el servidor y déjalo en ejecución:

```sh
git clone https://github.com/JosssphZhou/poki.git
cd poki
./bin/setup
npm start
```

Requiere macOS 15 o posterior, Xcode completo, Rust, Node.js 24+ y ffmpeg. `./bin/setup` comprueba qué dependencias faltan. La primera compilación tarda unos minutos.

Poki está pensado para macOS. Para Linux, consulta el port de la comunidad [poki-for-linux](https://github.com/carrotciallo/poki-for-linux) ([#16](https://github.com/JosssphZhou/poki/issues/16)), que se mantiene fuera de este repositorio.

Windows: port de la comunidad en [scy7796/poki-for-windows](https://github.com/scy7796/poki-for-windows) (mantenido por su autor, no probado por nosotros).

### Paquete precompilado para macOS arm64

Descarga `poki-v0.1.1-macos-arm64.tar.gz` desde la release y ejecuta:

```sh
tar -xzf poki-v0.1.1-macos-arm64.tar.gz
cd poki-v0.1.1
npm ci --no-audit --no-fund
npm start
```

El paquete incluye el puente nativo y las herramientas de idevice. No necesitas Rust ni `./bin/setup`. Sigues necesitando macOS en Apple Silicon, Xcode completo, Node.js 24+, Python 3 y ffmpeg. Registra tu cliente MCP e instala el Agent opcional como se describe más abajo.

En otra terminal, desde el mismo directorio, registra el servidor MCP:

```sh
claude mcp add --scope user poki-mcp -- node "$PWD/src/stdio.mjs"   # Claude Code
codex mcp add poki-mcp -- node "$PWD/src/stdio.mjs"                 # Codex
```

**Poki Agent.** Para usar el agente de terminal independiente de Poki o sus canales de mensajería, deja `npm start` en ejecución y abre otra terminal en el mismo directorio. Instala el agente, añade su comando al PATH de esta terminal e inicia sesión:

```sh
npm ci --prefix agent
export PATH="$PWD/bin:$PATH"
poki login
poki status
```

Poki Agent usa GPT-6.1 Terra (`gpt-6.1-terra`) con razonamiento low de forma predeterminada. Recomendamos mantener esta configuración: es la más rápida que hemos probado para tareas en el teléfono. Puedes cambiar el modelo con `POKI_AGENT_MODEL`; consulta [Ejecutar Poki Agent](agent/README.md).

Para un iPhone físico, primero emparéjalo con tu Mac por USB. Consulta [Configuración del iPhone físico](docs/physical-iphone.md).

## Prueba una tarea

Con Poki Agent, si hay un solo iPhone conectado, se selecciona automáticamente. Con varios dispositivos, añade `--device '<device UUID>'`.

```sh
node bin/call.mjs list_devices   # Busca el UUID de tu dispositivo
poki "Search esp32 in Chrome and summarize the top result"
```

> **Nota:** Poki controla tu iPhone real. Si le pides que envíe mensajes o haga pagos, lo hará. El contenido de la pantalla se envía al servicio de modelos que hayas configurado.

Cada vez más rápido: Poki Agent recuerda las tareas anteriores y las ejecuta más rápido al repetirlas.

**Canales:** Tras configurar un canal autorizado, inícialo con `poki imessage` o [`poki telegram`](agent/README.md#telegram). Consulta [Poki Agent](agent/README.md) para la configuración.

**Clientes MCP:** Claude Code, Codex y cualquier cliente compatible con JSON de `mcpServers`.

La compatibilidad con iPhone físico solo se ha verificado en iPhone con la interfaz en chino. Los dispositivos físicos solo admiten orientación vertical. No están disponibles la exportación de contenedores de apps ni los enlaces directos a subpáginas de Ajustes. Consulta [verificación y límites conocidos](docs/verification.md).

## Documentación

| Tema | Leer |
| --- | --- |
| Instalación, otros clientes MCP y solución de problemas | [Guía de instalación](docs/install.md) |
| Poki Agent, modelos, iMessage y Telegram | [Ejecutar Poki Agent](agent/README.md) |
| Referencia de herramientas MCP | [Comportamiento de las herramientas](docs/tools.md) |
| Variables de entorno y sesiones | [Configuración](docs/configuration.md) |
| Emparejamiento USB, modo de desarrollador y Wi-Fi | [Configuración del iPhone físico](docs/physical-iphone.md) |
| Resultados de pruebas, límites conocidos y avisos legales | [Verificación](docs/verification.md) |
| Arquitectura del puente | [Puente nativo](native/NATIVE.md) y [adaptador del simulador](native/simulator.md) |
| Hoja de ruta | [poki.bot](https://poki.bot) |

## Hoja de ruta

<p align="center">
  <img src="docs/images/roadmap.png" width="860" alt="Poki roadmap. Shipped: Poki MCP, Poki Agent, iMessage, Telegram, and Terminal integrations, self-learning routes, remote connections. In Progress: persistent connection performance improvements, native text input (clipboard-free), simplified tool interface. Planned: Poki App, which runs locally on iPhone and is available while your Mac is powered off. Future: iPhone Duo support, physical device support (no Xcode required), additional model providers.">
</p>

- **Publicado:** Poki MCP, Poki Agent, integraciones con iMessage, Telegram y la terminal, rutas de autoaprendizaje, Conexión remota
- **En desarrollo:** **mejoras de rendimiento en conexiones persistentes**, entrada de texto nativa (sin portapapeles), interfaz de herramientas simplificada
- **Planificado:** Poki App: ejecución local en el iPhone, disponible con el Mac apagado
- **Futuro:** Compatibilidad con iPhone Duo, compatibilidad con dispositivos físicos (sin Xcode), más proveedores de modelos

## Star History

<a href="https://www.star-history.com/?repos=JosssphZhou%2Fpoki&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&theme=dark&legend=top-left">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&legend=top-left">
    <img alt="Star History chart" src="https://api.star-history.com/chart?repos=JosssphZhou/poki&type=date&legend=top-left">
  </picture>
</a>

## Colaboradores principales

<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/ZhehanZhang"><img src="https://avatars.githubusercontent.com/u/67270559?v=4&size=240" width="120" height="120" alt="ZhehanZhang"/><br /><sub><b>ZhehanZhang</b></sub></a><br />El gran cocreador de Poki.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/igc110"><img src="https://avatars.githubusercontent.com/u/241411380?v=4&size=240" width="120" height="120" alt="igc110"/><br /><sub><b>igc110</b></sub></a><br />Descubrió en <a href="https://github.com/JosssphZhou/poki/issues/10">#10</a> por qué los toques en un iPhone físico eran lentos; la corrección posterior los hizo alrededor de un tercio más rápidos.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/edge369"><img src="https://avatars.githubusercontent.com/u/63720633?v=4&size=240" width="120" height="120" alt="edge369"/><br /><sub><b>edge369</b></sub></a><br />Hizo que Poki funcionara en un router en <a href="https://github.com/JosssphZhou/poki/pull/14">#14</a>, de modo que Telegram controla el iPhone con el Mac apagado; siguieron <a href="https://github.com/JosssphZhou/poki/pull/15">#15</a>, <a href="https://github.com/JosssphZhou/poki/pull/17">#17</a> y <a href="https://github.com/JosssphZhou/poki/issues/19">#19</a>.</td>
    </tr>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/carrotciallo"><img src="https://avatars.githubusercontent.com/u/69567867?v=4&size=240" width="120" height="120" alt="carrotciallo"/><br /><sub><b>carrotciallo</b></sub></a><br />Portó Poki a Linux y lo probó en un iPhone físico por USB, LAN y Tailscale en <a href="https://github.com/JosssphZhou/poki/issues/16">#16</a>; el README ahora lo enlaza.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/guangtouge82"><img src="https://avatars.githubusercontent.com/u/269691899?v=4&size=240" width="120" height="120" alt="guangtouge82"/><br /><sub><b>guangtouge82</b></sub></a><br />Rastreó en <a href="https://github.com/JosssphZhou/poki/issues/18">#18</a> los toques fallidos de un iPhone físico hasta la falta de display service; ahora Poki indica que no se envió nada y apunta a prepare-device.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/Dreaminmaster"><img src="https://avatars.githubusercontent.com/u/189544503?v=4&size=240" width="120" height="120" alt="Dreaminmaster"/><br /><sub><b>Dreaminmaster</b></sub></a><br />Corrigió una ruta en caché corrupta que abortaba tareas del Agent sin relación (<a href="https://github.com/JosssphZhou/poki/issues/21">#21</a>, <a href="https://github.com/JosssphZhou/poki/pull/22">#22</a>) y después hizo que el Agent reutilice la pantalla ya leída tras cada acción (<a href="https://github.com/JosssphZhou/poki/pull/37">#37</a>).</td>
    </tr>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/PeterKingXu1s"><img src="https://avatars.githubusercontent.com/u/89392314?v=4&size=240" width="120" height="120" alt="PeterKingXu1s"/><br /><sub><b>PeterKingXu1s</b></sub></a><br />Reportó en <a href="https://github.com/JosssphZhou/poki/issues/25">#25</a> que una petición de detener en lenguaje natural no interrumpía una tarea de iMessage; ahora Poki responde a los mensajes enviados durante la tarea y señala /stop.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/ScottH1122"><img src="https://avatars.githubusercontent.com/u/142722955?v=4&size=240" width="120" height="120" alt="ScottH1122"/><br /><sub><b>ScottH1122</b></sub></a><br />Reprodujo en <a href="https://github.com/JosssphZhou/poki/issues/27">#27</a> y <a href="https://github.com/JosssphZhou/poki/issues/28">#28</a> dos errores del Agent, controles desactivados ofrecidos como objetivos de toque y lotes con fallos parciales que perdían su traza; ambos están corregidos.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/jiahuipaung"><img src="https://avatars.githubusercontent.com/u/70688286?v=4&size=240" width="120" height="120" alt="jiahuipaung"/><br /><sub><b>jiahuipaung</b></sub></a><br />Corrigió en <a href="https://github.com/JosssphZhou/poki/pull/34">#34</a> una conexión RemotePairing que fallaba al cambiar la dirección LAN del iPhone (<a href="https://github.com/JosssphZhou/poki/issues/30">#30</a>); un iPhone real se reconectó en 768 ms.</td>
    </tr>
    <tr>
      <td align="center" valign="top" width="33%"><a href="https://github.com/scy7796"><img src="https://avatars.githubusercontent.com/u/282529358?v=4&size=240" width="120" height="120" alt="scy7796"/><br /><sub><b>scy7796</b></sub></a><br />Corrigió en <a href="https://github.com/JosssphZhou/poki/pull/39">#39</a> los toques que fallaban siempre por RemotePairing desde un host Windows; después, 5 de 5 toques funcionaron.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/foshanfm"><img src="https://avatars.githubusercontent.com/u/24779370?v=4&size=240" width="120" height="120" alt="foshanfm"/><br /><sub><b>foshanfm</b></sub></a><br />Hizo en <a href="https://github.com/JosssphZhou/poki/issues/42">#42</a> una comprobación de condiciones de seguros en un iPhone real por Tailscale; su informe orientó errores USB más claros y un cambio de transporte por sesión.</td>
      <td align="center" valign="top" width="33%"><a href="https://github.com/xiaweiyi713"><img src="https://avatars.githubusercontent.com/u/208608622?v=4&size=240" width="120" height="120" alt="xiaweiyi713"/><br /><sub><b>xiaweiyi713</b></sub></a><br />Grabó vídeos de demostración de Poki controlando un iPhone real, para que los visitantes nuevos vean qué hace antes de instalar nada.</td>
    </tr>
  </tbody>
</table>

## Menciones especiales

Gracias a todas las personas que han abierto un issue o un pull request; sus reportes y correcciones hacen que Poki sea cada vez mejor.

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

## Descargo de responsabilidad

Poki es un proyecto independiente de código abierto. No está afiliado a Apple, OpenAI ni a los creadores de ninguna app o sitio web que opere, ni cuenta con su respaldo. iPhone es una marca comercial de Apple Inc.

Automatizar apps y sitios web de terceros puede infringir sus condiciones de servicio. Decide por tu cuenta si usas Poki con un servicio determinado. Eres responsable de lo que haga en tu dispositivo y tus cuentas, incluidos los mensajes que envíe, los cambios que realice y cualquier restricción de cuenta que se derive de ello.

Poki se proporciona «tal cual», sin garantía, según lo establecido en la licencia AGPL-3.0.

En caso de ambigüedad, prevalece la versión en inglés.

## Licencia

Poki es código abierto bajo la [licencia AGPL-3.0-only](LICENSE).

Copyright (c) 2026 Joseph Zhou and contributors. Las dependencias de código abierto conservan sus respectivas licencias; consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Para contribuir, consulta [CONTRIBUTING.md](CONTRIBUTING.md).

## Agradecimientos

<p align="center">
  <img src="docs/images/acknowledgments.png" width="860" alt="Creado con código abierto: pi, idevice, idb, BlueBubbles, Hermes Agent, MCP SDK, sharp y FFmpeg"><br>
  <sub>Agradecimientos al código abierto: <a href="https://github.com/earendil-works/pi">pi</a> | <a href="https://github.com/jkcoxson/idevice">idevice</a> | <a href="https://github.com/facebook/idb">idb</a> | <a href="https://github.com/BlueBubblesApp/bluebubbles-server">BlueBubbles</a> | <a href="https://github.com/NousResearch/hermes-agent">Hermes Agent</a> | <a href="https://github.com/modelcontextprotocol/typescript-sdk">MCP SDK</a> | <a href="https://github.com/lovell/sharp">sharp</a> | <a href="https://github.com/FFmpeg/FFmpeg">FFmpeg</a></sub>
</p>
