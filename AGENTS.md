# Install Poki for Windows for your client

These steps are for an agent installing this repository on a Windows 11 PC. Run commands in PowerShell from the checkout unless a step says otherwise. At each **STOP**, tell the user exactly what they must do, then wait for them to confirm. Report the steps you finished and the ones left. Never call a stopped installation complete.

This installs Poki MCP for the client you are running in (Claude Code, Codex, or another MCP client), using the user's existing subscription. Poki Agent, Poki's own terminal agent with iMessage and Telegram channels, has not been tested on Windows; skip it unless the user asks, and say it is untested if they do.

1. **Check prerequisites.** Check each of these and report every one that is missing with its install hint before going on:

   | Tool | Check | Install hint |
   | --- | --- | --- |
   | Git | `git --version` | `winget install Git.Git` |
   | Node.js 24+ | `node -v` | `winget install OpenJS.NodeJS` |
   | Python 3.11+ | `python -V` | `winget install Python.Python.3.12` (on this machine, call `python`, not `python3`) |
   | Rust | `cargo -V` | `winget install Rustlang.Rustup`, then open a new terminal |
   | ffmpeg | `ffmpeg -version` | `winget install Gyan.FFmpeg` |
   | Apple Devices | `Get-AppxPackage AppleInc.AppleDevices` | Microsoft Store, "Apple Devices" |

   **STOP if Apple Devices is missing.** Installing a Store app needs the user. A newly installed tool may need a new terminal before it is on `PATH`.

2. **Clone and build.** Use the repository URL the user gave, or `https://github.com/scy7796/poki-for-windows.git`. Clone into a new directory and enter it; if you are already in the intended checkout, use it. Run:

   ```powershell
   ./bin/setup.ps1
   ```

   It fetches the pinned `idevice` dependency, builds `idevice-tools.exe` and the bridge `build\poki-native.exe`, and runs `npm ci`. Continue only when it exits without an error. If linking fails with `LNK1104: cannot open file 'msvcrt.lib'`, the MSVC C++ workload is missing: run `rustup default stable-x86_64-pc-windows-gnu` and run setup again. If PowerShell refuses to run the script, run it as `powershell -ExecutionPolicy Bypass -File bin/setup.ps1` for this one call instead of changing the user's policy.

3. **Install the Python packages.** These give Poki its OCR and its developer-disk-image downloader:

   ```powershell
   python -m pip install rapidocr onnxruntime-directml winsdk pymobiledevice3
   ```

   `onnxruntime-directml` runs OCR on the GPU. If it will not install, use `onnxruntime` instead; OCR then works on the CPU, about five times slower.

4. **Start the service in the background.** Start it hidden, with its output in a private log, and keep it running:

   ```powershell
   $log = Join-Path $env:LOCALAPPDATA 'PokiMCP\daemon.log'
   New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
   Start-Process node -ArgumentList 'src/daemon.mjs' -WorkingDirectory $PWD -WindowStyle Hidden -RedirectStandardOutput $log
   ```

   Wait until the log has a line containing `"event":"ready"`, then report the node process ID and the log path. If the port is already taken, a service is probably running already; check it with `node bin/call.mjs poki_mcp_status` instead of starting a second one. State, the token, and frames live in `%LOCALAPPDATA%\PokiMCP`. Never print the token from `mcp.json`.

5. **Register your own client and install its skill.** Keep existing configuration. Choose only the client you are running in:

   - Claude Code: `claude mcp add --scope user poki-mcp -- node "$PWD\src\stdio.mjs"`, then copy the skill: `Copy-Item -Recurse skills\poki-mcp "$env:USERPROFILE\.claude\skills\poki-mcp"`.
   - Codex: `codex mcp add poki-mcp -- node "$PWD\src\stdio.mjs"`, then copy the skill to `$env:USERPROFILE\.codex\skills\poki-mcp`.

   Create the parent `skills` folder first if it does not exist. If an MCP entry or skill named `poki-mcp` already exists, look at it first and keep the user's unrelated changes. Check that the registered path is absolute and points at this checkout. Read the installed `SKILL.md` before any phone operation. If the client only loads new tools in a new session, tell the user.

6. **Pair the iPhone. STOP before any device command until the user confirms each item.**

   - Open the Apple Devices app. It runs the Apple USB service on `127.0.0.1:27015`; nothing reaches the phone until it runs. Check with `Test-NetConnection 127.0.0.1 -Port 27015`.
   - **STOP:** ask the user to connect the iPhone by USB, unlock it, and tap **Trust This Computer**.
   - **STOP for Developer Mode:** Settings → Privacy & Security → Developer Mode, on, then the restart the phone asks for. It cannot be switched on from the PC while the phone has a passcode.
   - **STOP for UI Automation:** Settings → Developer → UI Automation, on.

   Then run `node bin/prepare-device.mjs`. It reports Developer Mode and installs Apple's developer disk image through pymobiledevice3. If that download fails, the image has to come from a Mac whose Xcode matches the phone's iOS version: ask the user for an unpacked `iOS_DDI/Restore` directory and run again with `$env:POKI_DDI_DIR` set to it. Done means `com.apple.coredevice.displayservice` appears in `.deps\idevice\target\release\idevice-tools.exe --udid <id> remotexpc`.

7. **Wi-Fi, only when the user asks for it.** With the phone still on USB and unlocked, run `python -m pymobiledevice3 lockdown wifi-connections on`, then `node bin/prepare-remote.mjs <device id> <phone IP>`. After that the cable can come out. Tell the user two things: input fails with CoreDevice error 9022 while another app on the phone holds the microphone, and Wi-Fi taps are slower than USB (about 7 s each in testing).

8. **Verify and report.** Run:

   ```powershell
   node bin/call.mjs poki_mcp_status
   node bin/call.mjs list_devices
   ```

   Report the version, the commit, `total_tools`, and whether the phone appears, with its `readiness` text. Over USB that text only says the phone was discovered; seeing it listed does not prove screenshots or input work. Before any tap, ask the user what is on the phone screen and get their go-ahead; then tap something harmless and check that the screen changed. Report every step you did not test (pairing, Wi-Fi, a tap) as untested.

## Update

When the user asks to update, run `git pull --ff-only` in the checkout, then `./bin/setup.ps1`. If the pull stops because of local changes, report them and leave them alone: do not reset, stash, or switch branches for the user. Tell the user to stop the running service (end the `node` process running `src/daemon.mjs`) and start it again as in step 4. Then run `node bin/call.mjs poki_mcp_status`.

`bin/update.mjs` has a Windows branch that runs `bin/setup.ps1` through `pwsh` (PowerShell 7), but it has not been tested here; prefer the steps above.
