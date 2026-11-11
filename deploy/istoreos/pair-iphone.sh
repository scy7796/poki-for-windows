#!/bin/sh
# Pair an iPhone plugged into the router's USB port, then list it.
# Usage: sh pair-iphone.sh [UDID]
set -eu

TOOLS=/app/.deps/idevice/target/release/idevice-tools

echo "== USB 设备 =="
docker exec poki python3 /app/native/devices.py

UDID=${1:-}
if [ -z "$UDID" ]; then
  UDID=$(docker exec poki python3 /app/native/devices.py 2>/dev/null | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4)
fi

if [ -z "$UDID" ]; then
  echo "没检测到 USB 设备。确认 iPhone 已插在路由 USB 口、已解锁并点了「信任」。"
  exit 1
fi

echo "== 配对 $UDID =="
docker exec poki "$TOOLS" --udid "$UDID" lockdown pair || true

echo "== 验证 =="
docker exec poki "$TOOLS" --udid "$UDID" lockdown get ProductVersion || true

echo "== list_devices =="
docker exec poki node bin/call.mjs list_devices
