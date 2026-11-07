# Install Poki for Windows for your client

These steps are for an agent installing this repository on a Windows 11 PC. Run commands in PowerShell from the checkout unless a step says otherwise; the Windows PowerShell 5.1 that ships with Windows is enough, PowerShell 7 works too. At each **STOP**, tell the user exactly what they must do, then wait for them to confirm. Report the steps you finished and the ones left. Never call a stopped installation complete.

This installs Poki MCP for the client you are running in (Claude Code, Codex, or another MCP client), using the user's existing subscription. Poki Agent, Poki's own terminal agent with iMessage and Telegram channels, has not been tested on Windows; skip it unless the user asks, and say it is untested if they do.

1. **Check prerequisites.** Check each of these. List every missing one with its install command, ask the user once whether you may run those commands, and run them on their yes:

   | Tool | Check | Install hint |
   | --- | --- | --- |
   | Git | `git --version` | `winget install Git.Git` |
   | Node.js 24+ | `node -v` | `winget install OpenJS.NodeJS` |
   | Python 3.11+ (3.12 recommended) | `python -V` | `winget install Python.Python.3.12`. If `python -V` prints nothing or opens the Microsoft Store, that is Windows' placeholder alias, not Python. Call `python`, not `python3`. |
   | Rust | `cargo -V` | `winget install Rustlang.Rustup`, then open a new terminal |
   | ffmpeg (optional) | `ffmpeg -version` | `winget install Gyan.FFmpeg`. Only screen recording needs it. |
   | Apple Devices | `Get-AppxPackage AppleInc.AppleDevices` | Microsoft Store, "Apple Devices" |

   **STOP if Apple Devices is missing.** Installing a Store app needs the user. A newly installed tool may need a new terminal before it is on `PATH`. Python 3.13 and newer work for everything except the `winsdk` fallback in step 3.

2. **Clone and build.** Use the repository URL the user gave, or `https://github.com/scy7796/poki-for-windows.git`. Clone into a new directory and enter it; if you are already in the intended checkout, use it. Run:

   ```powershell
   ./bin/setup.ps1
   ```

   It clones the pinned `idevice` dependency into `.deps\idevice`, switches its TLS backend to `rustcrypto` there (it prints "patched ... Cargo.toml"; `.deps` is ignored by git, so this repository's files stay untouched), builds `idevice-tools.exe` and the bridge `build\poki-native.exe`, and runs `npm ci`. It needs access to GitHub, crates.io and npm. The first build compiles about 400 crates: under two minutes on a fast desktop, longer on a laptop. Continue only when it exits without an error.

   If it fails:

   - `linker 'link.exe' not found`, or `LNK1104: cannot open file 'msvcrt.lib'`: Rust's default Windows toolchain wants Visual Studio's C++ build tools. Switch to the GNU toolchain, which brings its own linker: `rustup default stable-x86_64-pc-windows-gnu`, then run setup again.
   - `'python' does not run Python`: the Store alias is first on `PATH`. Install Python as in step 1 and open a new terminal.
   - PowerShell refuses to run the script: run `powershell -ExecutionPolicy Bypass -File bin/setup.ps1` for this one call instead of changing the user's policy.
   - A clone or `npm ci` fails on the network: report the error and ask the user to check their connection or proxy, then run setup again. Setup can be rerun safely while the service is stopped.

3. **Install the Python packages.** These give Poki its OCR and its developer-disk-image downloader:

   ```powershell
   python -m pip install --upgrade rapidocr onnxruntime-directml pymobiledevice3
   python native/ocr_win.py docs/images/poki-icon.png
   ```

   The second line runs OCR once on an image from this repository. The first run downloads two small models (about 6 MB) from modelscope.cn; if it fails there, report the error, since OCR on the phone will fail the same way. It prints JSON, possibly an empty list, when it works.

   `onnxruntime-directml` runs OCR on the GPU, and falls back to the CPU by itself on a PC without a DirectX 12 GPU. If it will not install, use `onnxruntime` instead; OCR then runs on the CPU, about five times slower.

   Optional, Python 3.11 or 3.12 only: `python -m pip install winsdk` adds Windows' built-in OCR as a second engine, used only when the first one cannot load. It reads only the languages installed for the Windows user.

4. **Start the service in the background.** First check whether one is already running: if `node bin/call.mjs poki_mcp_status` answers, use that service and skip to step 5. Otherwise start it hidden, with its output in a private log:

   ```powershell
   $log = Join-Path $env:LOCALAPPDATA 'PokiMCP\daemon.log'
   New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
   $p = Start-Process node -ArgumentList 'src/daemon.mjs' -WorkingDirectory $PWD -WindowStyle Hidden -RedirectStandardOutput $log -PassThru
   for ($i = 0; $i -lt 30; $i++) {
     if (Select-String -Quiet -Path $log -Pattern '"event":"ready"') { break }
     if ($p.HasExited) { throw "The service exited with code $($p.ExitCode); see $log" }
     Start-Sleep 1
   }
   $p.Id
   ```

   Report the process ID and the log path. If no ready line appears within 30 seconds, report the end of the log. The service listens on port 47825; if another program holds that port it exits at once. State, the token, and frames live in `%LOCALAPPDATA%\PokiMCP`. Never print the token from `mcp.json`.

   To try the install without touching an existing service, set `$env:POKI_MCP_STATE_DIR` to a private folder and add `'--port','0'` to the arguments: the ready line then reports the port it picked. Run `bin/call.mjs` with the same `POKI_MCP_STATE_DIR` to reach it.

5. **Register your own client and install its skill.** Keep existing configuration. Choose only the client you are running in:

   - Claude Code:

     ```powershell
     claude mcp add --scope user poki-mcp -- node "$PWD\src\stdio.mjs"
     $skill = "$env:USERPROFILE\.claude\skills\poki-mcp"
     ```

   - Codex:

     ```powershell
     codex mcp add poki-mcp -- node "$PWD\src\stdio.mjs"
     $skill = "$env:USERPROFILE\.codex\skills\poki-mcp"
     ```

   Then copy the skill's contents (copying the folder onto an existing one would nest it as `poki-mcp\poki-mcp`):

   ```powershell
   New-Item -ItemType Directory -Force $skill | Out-Null
   Copy-Item -Recurse -Force skills\poki-mcp\* $skill
   ```

   If an MCP entry or skill named `poki-mcp` already exists, look at it first and keep the user's unrelated changes. Check that the registered path is absolute and points at this checkout. Read the installed `SKILL.md` before any phone operation. If the client only loads new tools in a new session, tell the user.

6. **Pair the iPhone.** Do these in order; each STOP waits for the user.

   1. Check the Apple USB service with `Test-NetConnection 127.0.0.1 -Port 27015`. If it is `False`, **STOP:** ask the user to open the Apple Devices app, then check again. Nothing reaches the phone until this port answers.
   2. **STOP:** ask the user to connect the iPhone by USB, unlock it, and tap **Trust This Computer**. Then run `node bin/call.mjs list_devices` and note the phone's `id`.
   3. Run `node bin/prepare-device.mjs <id>`. If its `Developer mode` line starts with "needs a person", the run has just made the Developer Mode switch appear on the phone, and the disk-image line after it will fail; that is expected at this point. **STOP:** ask the user to open Settings → Privacy & Security → Developer Mode, turn it on, restart the phone when it asks, and unlock it again. It cannot be switched on from the PC while the phone has a passcode, so do not rely on `--enable-developer-mode`.
   4. Run `node bin/prepare-device.mjs <id>` again. Now it should report Developer Mode on and install Apple's developer disk image through pymobiledevice3. If the download fails, the image has to come from a Mac whose Xcode matches the phone's iOS version: ask the user for an unpacked `iOS_DDI/Restore` directory, set `$env:POKI_DDI_DIR` to it, and run again.
   5. **STOP:** ask the user to open Settings → Developer → UI Automation and turn it on.

   Done means `com.apple.coredevice.displayservice` appears in the output of `.deps\idevice\target\release\idevice-tools.exe --udid <id> remotexpc`.

7. **Wi-Fi, only when the user asks for it.** The PC and the phone must be on the same network (the phone's own hotspot works). Ask the user for the phone's IP address, shown in Settings → Wi-Fi → the (i) next to the network. With the phone still on USB and unlocked, run:

   ```powershell
   python -m pymobiledevice3 lockdown wifi-connections on
   node bin/prepare-remote.mjs <id> <phone IP>
   ```

   The script calls the address "TAILSCALE_IP" in its usage text; any reachable IP works. It uses port 49152 unless a third argument says otherwise, and refuses to run unless the phone is listed with `connection` `USB`. After it succeeds the cable can come out. Tell the user two things: input fails with CoreDevice error 9022 while another app on the phone holds the microphone, and Wi-Fi taps are slower than USB (about 7 s each in testing).

8. **Verify and report.** Run:

   ```powershell
   node bin/call.mjs poki_mcp_status
   node bin/call.mjs list_devices
   ```

   Report `implementation` (the version), `commit`, `total_tools`, and whether the phone appears, with its `readiness` text. Over USB that text only says the phone was discovered; seeing it listed does not prove screenshots or input work. Before any tap, ask the user what is on the phone screen and get their go-ahead; then tap something harmless and check that the screen changed. Report every step you did not test (pairing, Wi-Fi, a tap) as untested.

## Update

When the user asks to update, run `git pull --ff-only` in the checkout. If the pull stops because of local changes, report them and leave them alone: do not reset, stash, or switch branches for the user. Then stop the service before building, because Windows will not let `npm ci` replace files a running process has loaded: ask the user, then end the `node` process running `src/daemon.mjs` from this checkout together with its children, `taskkill /PID <id> /T /F`, so no `poki-native.exe` it started is left behind. Run `./bin/setup.ps1`, start the service as in step 4, and run `node bin/call.mjs poki_mcp_status`.

`bin/update.mjs` has a Windows branch that runs `bin/setup.ps1` through `pwsh` (PowerShell 7), which is not installed on every PC and has not been tested here; prefer the steps above.
