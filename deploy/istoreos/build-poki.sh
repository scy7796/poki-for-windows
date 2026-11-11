#!/bin/sh
# Build poki-native + idevice-tools for aarch64 Linux (glibc) inside the rust:1-bookworm container.
set -eu

REV=89702099f4d7552f704f93b4526756abda319ceb
SRC=/src
JOBS=${JOBS:-2}

echo "== [1/4] apt =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends git cmake clang perl pkg-config ca-certificates >/dev/null
echo "cmake: $(cmake --version | head -1)"

echo "== [2/4] idevice source @ $REV =="
if [ ! -f "$SRC/.deps/idevice/idevice/Cargo.toml" ]; then
  rm -rf "$SRC/.deps/idevice"
  mkdir -p "$SRC/.deps"
  git clone --filter=blob:none https://github.com/jkcoxson/idevice.git "$SRC/.deps/idevice"
fi
git -C "$SRC/.deps/idevice" fetch --depth 1 origin "$REV" || true
git -C "$SRC/.deps/idevice" checkout --detach "$REV"
echo "head: $(git -C "$SRC/.deps/idevice" rev-parse HEAD)"

echo "== [3/4] idevice-tools =="
# The workspace forces lto+codegen-units=1, which is very slow and memory hungry on RK3568.
cd "$SRC/.deps/idevice"
CARGO_PROFILE_RELEASE_LTO=false \
CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
CARGO_PROFILE_RELEASE_OPT_LEVEL=2 \
  cargo build --locked --release -p idevice-tools --bin idevice-tools --bin idevice_id -j "$JOBS"
ls -lh target/release/idevice-tools target/release/idevice_id

echo "== [4/4] poki-native =="
cd "$SRC"
cargo build --locked --release \
  --manifest-path native/bridge/Cargo.toml \
  --target-dir /out/native-target \
  --bin poki-native -j "$JOBS"
mkdir -p "$SRC/build"
cp /out/native-target/release/poki-native "$SRC/build/poki-native"
chmod 755 "$SRC/build/poki-native"
file "$SRC/build/poki-native"
ls -lh "$SRC/build/poki-native"

echo "== DONE =="
