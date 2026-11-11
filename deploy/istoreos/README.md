# Poki on iStoreOS (aarch64, Docker)

Runs the MCP daemon — and optionally the Telegram channel — on an iStoreOS router so the iPhone can be driven without a Mac staying awake. The phone is reached over Wi-Fi with RemotePairing; the USB path is optional.

Measured on an EasePi A2 (RK3568, 4 GB RAM, no swap), iStoreOS 25.12.6, Docker 29.6.1.

## Why a container

The host is **musl** (`/lib/ld-musl-aarch64.so.1`). Two consequences:

- Node 24 has no musl aarch64 build in the distribution feeds, and Poki requires Node 24+.
- The native bridge is compiled against glibc, because `aws-lc-sys` is painful to build for musl and the toolchain is not installable on the router.

So everything runs in a `node:24-bookworm-slim` based image (`poki:linux`). The router itself only needs Docker.

## Requirements

- iStoreOS with Docker and at least **8 GB free on the data disk**. The image plus build artifacts do not fit on the overlay.
- A phone already paired once with a Mac that has the full Xcode toolchain, or the willingness to build `idevice-tools` for the router (see below).
- `usbmuxd` present on the host if you want the USB path; it is optional.

## 0. Put the repository on the router

Every command below runs **on the router**, over SSH, from the checkout directory unless stated otherwise. Clone into the data disk, not the overlay:

```sh
mkdir -p /mnt/data/poki
git clone https://github.com/JosssphZhou/poki.git /mnt/data/poki/src
cd /mnt/data/poki/src
```

`/mnt/data/poki/src` is then mounted at `/app` in the runtime container, so the daemon runs the source you cloned rather than a copy baked into the image.

## 1. Build the native bridge

`poki-native` and `idevice-tools` must be compiled **on the router**, inside a container, because the Mac cannot produce a glibc aarch64 binary without an extra toolchain.

Run this from the checkout root (`/mnt/data/poki/src`):

```sh
docker run -d --name poki-build \
  -v /mnt/data/poki/src:/src \
  -v /mnt/data/poki/build:/out \
  -v /mnt/data/poki/cargo-home:/cargo \
  -e CARGO_HOME=/cargo \
  -e JOBS=1 \
  -e PATH=/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  -w /src rust:1-bookworm sh /src/deploy/istoreos/build-poki.sh
docker wait poki-build
```

`deploy/istoreos/build-poki.sh` clones `jkcoxson/idevice` at the revision `bin/setup` pins, builds `idevice-tools`, then builds `poki-native` into `/out`. It overrides the workspace profile (`lto = false`, `codegen-units = 16`); the default `lto = true` makes this take far longer than the ~42 minutes measured at `JOBS=2`.

`JOBS=1` or `JOBS=2`. Four A55 cores and no swap will OOM at higher parallelism. `docker wait` blocks until the build exits, which is the only signal that it finished: `docker run -d` returns immediately.

Do not mount a volume over `/usr/local/cargo` — it shadows the `cargo` binary that ships in the image. Mount a separate directory and set `CARGO_HOME` instead.

## 2. Install the runtime

From `deploy/istoreos`:

```sh
cd deploy/istoreos
docker build -t poki:linux .
```

The image adds `python3`, which `native/devices.py` needs for the usbmuxd socket and `bin/prepare-remote.mjs` needs at pairing time.

The MCP server dependencies are not part of the image, so install them into the checkout itself. From the checkout root:

```sh
docker run --rm -v /mnt/data/poki/src:/app -w /app poki:linux npm ci --no-audit --no-fund
```

Do not copy `node_modules` from a Mac: `sharp` ships per-platform binaries and the arm64 macOS build will not load on Linux.

## 3. Start the daemon

From `deploy/istoreos`:

```sh
BASE_DIR=/mnt/data/poki sh run-poki.sh
```

The script generates a bearer token into `$BASE_DIR/token` (0600), writes the container's environment to `$BASE_DIR/poki.env` (0600) and passes it with `--env-file`, then starts the container with `--network host`. It prints the endpoint path, the token path, the bind address and the Host allowlist — not the token.

`--env-file` keeps the token off the command line and out of shell history. It does **not** hide it from `docker inspect`: Docker reads the file client-side and stores the variables in the container's `Config.Env`. Anyone who can run `docker inspect` on the router is effectively root already, so this is about not leaking the secret into logs and process listings.

The token is fixed across restarts through `POKI_MCP_TOKEN`; otherwise the daemon generates a fresh one every launch and every client breaks. To rotate it, delete `$BASE_DIR/token` and rerun `run-poki.sh`, then update the clients.

The daemon listens on the router's `br-lan` address and on `127.0.0.1`. The loopback listener is not optional: `src/stdio.mjs` accepts a `127.0.0.1` endpoint only, and the agent, `bin/call.mjs` and the pairing helper all reach the daemon through it. `mcp.json` therefore always records the loopback URL, and the LAN address is for other machines.

Configuration goes through three environment variables that this branch adds to `src/daemon.mjs`. The two columns are different: the daemon's defaults apply when a variable is unset, and `run-poki.sh` sets all three explicitly for a router.

| Variable | Daemon default | What `run-poki.sh` sets |
| --- | --- | --- |
| `POKI_BIND_HOST` | `127.0.0.1` | the `br-lan` address, else `127.0.0.1`; accepts a comma-separated list, and `127.0.0.1` is always added |
| `POKI_HOST_ALLOW` | unset, so `localhostHostValidation()` applies | `127.0.0.1` plus the `br-lan` address |
| `POKI_MCP_TOKEN` | random per start | the contents of `$BASE_DIR/token` |

When `POKI_HOST_ALLOW` is set it replaces `localhostHostValidation()`, which otherwise rejects any non-loopback `Host` with `403`. It must contain `127.0.0.1` itself: local clients are pinned to that name, so an entry for `localhost` or `[::1]` does not cover the `Host: 127.0.0.1:47825` they send, and they are locked out.

Clients must send `X-Poki-MCP-Session`; the daemon answers `400` without it.

**The bridge is plain HTTP.** The bearer token is the only control, so it is exactly as safe as the network it crosses: keep the daemon on a LAN or tailnet you trust, keep guest Wi-Fi off that segment, and reach it over a tailnet rather than a forwarded port when the client is somewhere else.


```json
{
  "mcpServers": {
    "poki": {
      "type": "http",
      "url": "http://ROUTER-LAN-IP:47825/mcp",
      "headers": {
        "Authorization": "Bearer TOKEN",
        "X-Poki-MCP-Session": "client-1"
      }
    }
  }
}
```

## 4. Connect the iPhone

Prefer RemotePairing over Wi-Fi. Many RK3568 boards wire only the SuperSpeed pair on the blue USB 3.0 port, so a phone on it charges but never enumerates: `portsc` reports `Powered / Not-connected / Link:RxDetect / PortSpeed:0` while the device tree says `dr_mode = host`. Check `/sys/kernel/debug/usb/xhci/*/ports/port01` before blaming drivers.

On the Mac that has the phone attached over USB:

```sh
idevice-tools --udid UDID lockdown set EnableWifiConnections true
node bin/prepare-remote.mjs UDID PHONE-LAN-IP
```

`EnableWifiConnections` is what actually turns on the phone's Wi-Fi transport; you do not need to tick "Connect via network" in Xcode. After it succeeds, the device appears under `_apple-mobdev2._tcp` with a `supportsRP-26` tag, and its RemotePairing listener accepts connections on port `49152`.

Copy the result to the router and rewrite both paths to the **container's** view of the state directory:

```
state/remote/UDID/pairing.plist
state/remote/UDID/config.json      pairing_file -> /state/remote/UDID/pairing.plist
state/remote-devices.json          config_path  -> /state/remote/UDID/config.json
```

A host path such as `/mnt/data/poki/state/...` makes the helper exit immediately with `No such file or directory (os error 2)`, which the daemon reports as `Remote helper stopped before becoming ready (exit code 1)` followed by the helper's stderr.

`pairing.plist` is portable between machines: it holds the host key, not the machine identity, so generating it on a Mac and running it on the router works.

### Enabling Wi-Fi automation on the phone

Settings → Privacy & Security → Developer Mode → **Enable UI Automation**. Without it the accessibility tree is empty: `take_screenshot` still works but returns `structure_source: null`, and `list_apps` fails with `service not found`. This is not a transport limit.

## 5. Optional: Telegram channel

From `deploy/istoreos`:

```sh
mkdir -p /mnt/data/poki/telegram
cp telegram.json.example /mnt/data/poki/telegram/telegram.json   # then edit device and auth
(umask 077; read -rs TOKEN; printf '%s' "$TOKEN" > /mnt/data/poki/telegram-token)   # paste the bot token
docker run --rm -v /mnt/data/poki/src:/app -w /app/agent poki:linux npm ci --no-audit --no-fund
sh start-telegram.sh --check
sh start-telegram.sh
```

`telegram.json.example` contains only the keys the worker accepts: `device`, `auth`, `allowedUsers`. It leaves `model` out on purpose, so the agent's own default applies. This branch does not add model providers: the worker and `agent/model-config.mjs` support the OpenAI configurations that ship with the agent today. Running something else on the router takes a separate patch, which belongs in its own change rather than here.

`start-telegram.sh` writes the bot token into `$BASE_DIR/telegram/telegram.env` (0600) and passes it with `--env-file`. As above, that keeps it off the command line, not out of `docker inspect`.

**Model credentials.** The container is not your Mac: nothing in your shell reaches it. Pick one of these before the first message, or the task fails with "Set OPENAI_API_KEY in your environment":

**API key.** `"auth": "api-key"` reads `OPENAI_API_KEY`:

```sh
# read without echoing, so the key is not in shell history and the file is never 0644
(umask 077; read -rs KEY; printf '%s' "$KEY" > /mnt/data/poki/openai-key)
```

`start-telegram.sh` copies that file into the env file on every start.

**ChatGPT sign-in.** `"auth": "chatgpt"` reads a credentials file instead. Sign in with a browser anywhere, into a path of its own rather than the one your Mac uses day to day:

```sh
POKI_AGENT_AUTH_FILE=/tmp/router-auth.json poki login --auth chatgpt
install -m 600 /tmp/router-auth.json /mnt/data/poki/telegram/auth.json && rm /tmp/router-auth.json
```

On the router that file is `$BASE_DIR/telegram/auth.json`, and it appears in the container as `/tg/auth.json`, because `$CONF_DIR` is already mounted at `/tg`. It is not mounted separately and it must stay writable: the agent refreshes its access token and writes the file back, so a read-only mount turns the next refresh into `Credential store modify failed` and every task after it fails.

Do not point the container at your Mac's own `~/.pi/agent/auth.json` and keep using that Mac for tasks. One sign-in copied to two machines holds one refresh token, and the first refresh on either side invalidates the other.

The worker talks to the daemon through `src/stdio.mjs`, which reads the loopback endpoint from `/state/mcp.json`, so `--network host` matters. Copy the model configuration from `~/.config/poki-agent` into `$BASE_DIR/agent-config` and mount it at `/root/.config/poki-agent`; set `HOME=/root` or the agent will not find it.

The bot must not have a webhook — the worker polls and refuses to start otherwise. `getUpdates` returns nothing until the owner sends the bot a message, so configure `allowedUsers` after that first message.

## What works over RemotePairing

Available: screenshots, accessibility tree, foreground app, taps and gestures, keyboard input, `launch_app`, `list_apps`, device info, tunnel reconnect.

Rejected by design: `install_app`, `uninstall_app`, `terminate_app`, clipboard tools, settings and appearance changes, location simulation, crash logs, container download, recording, and every simulator tool.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `deadline has elapsed` on every call | A stale `poki-native --remote-server` from an earlier run holds the phone. `pkill -f "poki-native --remote-server"` and remove `/tmp/poki-remote-*/​*.sock`. |
| `Pair verify failed` | The configured host is a different device. Find the right IP with `dns-sd -B _remotepairing._tcp`; do not trust ARP, iPhones rotate their Wi-Fi MAC. |
| `service not found` | UI Automation is off, or the phone is locked. |
| `A message worker already owns this state directory` | The lock records a PID that a new container reused. `start-telegram.sh` removes it before starting. |
| `spawn python3 ENOENT` | The image is missing `python3`; `native/devices.py` needs it. |
