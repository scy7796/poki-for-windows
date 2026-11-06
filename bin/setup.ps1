<#
.SYNOPSIS
  Builds Poki MCP on Windows.

.DESCRIPTION
  macOS gets these helpers from Xcode: a Vision OCR binary, a simulator driver and
  a Rust bridge. Windows has no Xcode, so this script builds what does exist —
  the pinned idevice tools and the Rust bridge — and explains the one thing it
  cannot install for you, which is a text recognizer.

  Everything it changes stays inside the checkout, and every step is repeatable.
#>
[CmdletBinding()]
param(
  [switch]$SkipDeviceTools,
  [switch]$SkipNpm
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Need($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name is required. $hint"
  }
}

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

Step 'Checking prerequisites'
Need git 'Install Git for Windows.'
Need node 'Install Node.js 24 or newer.'
Need cargo 'Install Rust with rustup, then reopen this window.'
Need python 'Install Python 3.11 or newer and add it to PATH.'
Need ffmpeg 'Run: winget install Gyan.FFmpeg'

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 24) { throw "Node.js 24 or newer is required; found $(& node -v)." }
Write-Host "git, node $(& node -v), cargo $(& cargo -V), python $(& python -V), ffmpeg present"

$crypto = 'rustcrypto'
Step "Fetching the pinned idevice dependency (TLS backend: $crypto)"
$pinned = '89702099f4d7552f704f93b4526756abda319ceb'
if (-not (Test-Path '.deps/idevice/.git')) {
  New-Item -ItemType Directory -Force -Path '.deps' | Out-Null
  & git clone https://github.com/jkcoxson/idevice.git '.deps/idevice'
  if ($LASTEXITCODE -ne 0) { throw 'Cloning idevice failed.' }
}
& git -C '.deps/idevice' checkout --detach $pinned
if ($LASTEXITCODE -ne 0) { throw "Checking out $pinned failed." }

# aws-lc needs CMake, NASM and Perl. rustcrypto is pure Rust, so the toolchain that
# ships with rustup is enough. The change is recorded, not silent.
foreach ($file in 'idevice/Cargo.toml', 'tools/Cargo.toml') {
  $path = Join-Path '.deps/idevice' $file
  $text = Get-Content $path -Raw
  $patched = $text -replace 'default = \["aws-lc"\]', "default = [`"$crypto`"]"
  if ($patched -ne $text) {
    Set-Content -Path $path -Value $patched -NoNewline
    Write-Host "patched $path to the $crypto TLS backend"
  }
}

if (-not $SkipDeviceTools) {
  Step 'Building idevice-tools'
  # Point cargo at the dependency's manifest: the repository root has no Cargo.toml. --locked
  # matches bin/setup, so a fresh clone builds exactly the pinned tree.
  & cargo build --locked --release --no-default-features --features $crypto --manifest-path .deps/idevice/Cargo.toml -p idevice-tools --bin idevice-tools --bin idevice_id
  if ($LASTEXITCODE -ne 0) { throw 'Building idevice-tools failed.' }
  # Cargo writes the binaries under the workspace it was pointed at, so nothing is copied.
  $release = '.deps/idevice/target/release'
  foreach ($name in 'idevice-tools.exe', 'idevice_id.exe') {
    if (-not (Test-Path (Join-Path $release $name))) { throw "$name was not built in $release." }
  }
  Write-Host "idevice-tools.exe and idevice_id.exe are in $release"
}

if (-not $SkipNpm) {
  Step 'Installing Node dependencies'
  & npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. Windows builds of sharp are downloaded, so this needs network access once.' }
}

Step 'Building the native bridge'
& node bin/build-native.mjs
if ($LASTEXITCODE -ne 0) { throw 'Building the bridge failed.' }

Step 'Next'
Write-Host @'
1. Start the Apple USB service by opening the Apple Devices app. Nothing listens on
   127.0.0.1:27015 until it runs, and every idevice call needs that port.
2. Connect the iPhone, unlock it, and accept "Trust This Computer".
3. node bin/prepare-device.mjs          (developer mode and the developer disk image)
4. node bin/call.mjs poki_mcp_status
'@
