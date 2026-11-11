#!/bin/bash
# check.sh [--apps|--cycle] [NATIVE_DIR]
# On a new simulator, Poki's in-process code (NATIVE_DIR, default this checkout's Poki/Native) reads the
# fixture app's element tree, taps its text field, types, and reads the value and keyboard focus back.
# The tree must hold every labelled element that the simulator's own accessibility reader
# (native/simulator.m) reports for the same screen. With --apps it instead launches the fixture, launches
# Settings, activates the fixture (the same process returns), launches it again (a new process) and
# terminates it. With --cycle the field check runs after the session was closed and opened again, as Poki
# does when it is idle. POKI_CHECK_IPAD=1 runs the same check on an iPad. (An iPhone-only app on iPad reports
# its elements in its own scaled coordinates with the origin at 0,0, so taps from its tree miss: not handled yet); a touch sent while closed must not use the closed session (refused, or a new one). The simulator is deleted afterwards.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MODE=field
if [ "${1:-}" = "--apps" ]; then MODE=apps; shift; fi
if [ "${1:-}" = "--cycle" ]; then MODE=cycle; shift; fi
REPO="$(cd "$HERE/../../../.." && pwd)"
NATIVE="$(cd "${1:-$REPO/native/ios-app/Poki/Native}" && pwd)"
X="$(xcode-select -p)/Platforms/iPhoneSimulator.platform/Developer"
TEXT="${POKI_CHECK_TEXT:-ESP173 读屏}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/poki-inprocess.XXXXXX")"
UDID=""
cleanup() {
  if [ -n "$UDID" ]; then xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true; xcrun simctl delete "$UDID" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
APP="$WORK/InProcessCheck.app"; mkdir -p "$APP"
xcrun --sdk iphonesimulator clang -target arm64-apple-ios26.0-simulator -isysroot "$SDK" -fobjc-arc -fmodules \
  -Wall -Werror -Wno-deprecated-declarations -I "$NATIVE" \
  "$HERE/main.m" "$NATIVE/InProcess.m" "$NATIVE/RecoveredNative.m" -framework UIKit -o "$APP/InProcessCheck"
cp "$HERE/Info.plist" "$APP/Info.plist"
codesign -s - --force "$APP" >/dev/null 2>&1
xcrun clang -fobjc-arc -fblocks -framework Foundation -framework AppKit -framework UniformTypeIdentifiers \
  "$REPO/native/simulator.m" -o "$WORK/simulator"
xcodebuild -project "$REPO/bin/fixture-app/PokiMCPFixture.xcodeproj" -scheme PokiMCPFixture -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$WORK/fixture" CODE_SIGNING_ALLOWED=NO -quiet build
FIXTURE="$WORK/fixture/Build/Products/Debug-iphonesimulator/PokiMCPFixture.app"

read -r RUNTIME TYPE < <(xcrun simctl list runtimes -j | python3 -c '
import json, sys
r = [x for x in json.load(sys.stdin)["runtimes"] if x["platform"] == "iOS" and x["isAvailable"]][-1]
family = "iPad" if sys.argv[1] else "iPhone"
print(r["identifier"], next(t["identifier"] for t in r["supportedDeviceTypes"] if t["productFamily"] == family))' "${POKI_CHECK_IPAD:-}")
UDID="$(xcrun simctl create poki-inprocess-check "$TYPE" "$RUNTIME")"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl install "$UDID" "$APP"
xcrun simctl install "$UDID" "$FIXTURE"

export SIMCTL_CHILD_POKI_SIMULATOR_DEVELOPER_DIR="$X"
export SIMCTL_CHILD_DYLD_FRAMEWORK_PATH="$X/Library/Frameworks:$X/Library/PrivateFrameworks"
export SIMCTL_CHILD_DYLD_LIBRARY_PATH="$X/usr/lib"
# POKI_INPROCESS_OWNED_SESSION=1 makes Poki open its own daemon session instead of XCTest's shared one.
[ -n "${POKI_INPROCESS_OWNED_SESSION:-}" ] && export SIMCTL_CHILD_POKI_INPROCESS_OWNED_SESSION=1
DOCS="$(xcrun simctl get_app_container "$UDID" local.poki.inprocess-check data)/Documents"
if [ "$MODE" = apps ]; then
  xcrun simctl launch "$UDID" local.poki.inprocess-check -mode apps -tag apps -delay 2 >/dev/null
  for _ in $(seq 120); do [ -s "$DOCS/apps.json" ] && break; sleep 1; done
  OUT="${POKI_CHECK_OUT:-}"; if [ -n "$OUT" ]; then mkdir -p "$OUT"; cp "$DOCS/apps.json" "$OUT/"; fi
  cat "$DOCS/apps.json"
  RUNNING="$(xcrun simctl spawn "$UDID" launchctl list | grep -c 'UIKitApplication:local.pokimcp.fixture\[' || true)"
  python3 - "$DOCS/apps.json" "$RUNNING" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert r["prepare"].get("ok"), f"no session: {r['prepare']}"
s = r["steps"]
fixture, settings = "local.pokimcp.fixture", "com.apple.Preferences"
for i, (action, bundle, front) in enumerate([("launch", fixture, fixture), ("launch", settings, settings), ("activate", fixture, fixture), ("launch", fixture, fixture)]):
    assert s[i]["code"] == "" and s[i]["front"] == front, f"step {i + 1} {action} {bundle}: {s[i]}"
assert s[2]["front_pid"] == s[0]["front_pid"], f"activate started a new process: {s[0]['front_pid']} then {s[2]['front_pid']}"
assert s[3]["front_pid"] != s[0]["front_pid"], f"launch kept the running process {s[3]['front_pid']}"
assert s[4]["code"] == "" and s[4]["front"] != fixture, f"terminate: {s[4]}"
assert sys.argv[2] == "0", f"the fixture still runs after terminate ({sys.argv[2]} launchd jobs)"
PY
  echo "in-process launch, launch, activate, relaunch and terminate passed"
  exit 0
fi
xcrun simctl launch "$UDID" local.poki.inprocess-check -mode "$MODE" -tag field -delay 8 -text "$TEXT" -times "${POKI_CHECK_TIMES:-1}" >/dev/null
sleep 3
xcrun simctl launch "$UDID" local.pokimcp.fixture >/dev/null
for _ in $(seq 90); do [ -s "$DOCS/field.json" ] && break; sleep 1; done
if [ ! -s "$DOCS/field.json" ]; then
  echo "::error::the check app wrote no result in 90 s"
  [ -s "$DOCS/field-progress.json" ] && { echo "progress:"; cat "$DOCS/field-progress.json"; }
  echo "check app running: $(xcrun simctl spawn "$UDID" launchctl list | grep -c 'local.poki.inprocess-check' || true)"
  for f in $(ls -t ~/Library/Logs/DiagnosticReports/InProcessCheck* 2>/dev/null | head -1); do echo "== crash $f"; head -60 "$f"; done
  xcrun simctl spawn "$UDID" log show --last 3m --predicate 'process == "InProcessCheck" OR process == "testmanagerd"' --style compact 2>/dev/null | tail -60 || true
  OUT="${POKI_CHECK_OUT:-}"; if [ -n "$OUT" ]; then mkdir -p "$OUT"; cp "$DOCS"/field* "$OUT/" 2>/dev/null || true; cp ~/Library/Logs/DiagnosticReports/InProcessCheck* "$OUT/" 2>/dev/null || true; fi
  exit 1
fi
echo "{\"id\":\"$UDID\",\"op\":\"ax\"}" | "$WORK/simulator" > "$WORK/reference.json"
OUT="${POKI_CHECK_OUT:-}"
if [ -n "$OUT" ]; then mkdir -p "$OUT"; cp "$DOCS"/field* "$WORK/reference.json" "$OUT/"; xcrun simctl io "$UDID" screenshot "$OUT/screen.png" >/dev/null 2>&1 || true; fi
cat "$DOCS/field.json"
python3 - "$DOCS/field.json" "$TEXT" "$MODE" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert r["prepare"].get("ok"), f"no session: {r['prepare']}"
if sys.argv[3] == "cycle":
    assert r["close"].get("closed"), f"close found no session: {r['close']}"
    t = r["closed_touch"]
    assert t["delivery"] == 0 or t["generation_after"] > t["generation_before"], f"a touch after close went through the closed session: {t}"
    assert r["prepare2"].get("ok"), f"the session did not open again: {r['prepare2']}"
    assert r["prepare2"]["generation"] > r["prepare"]["generation"], f"the reopened session kept generation {r['prepare2']['generation']}"
    assert "source_code2" not in r, f"no element tree after reopening: {r['source_code2']}"
    assert r["front2"].get("bundleId") == "local.pokimcp.fixture", f"front app after reopening: {r['front2']}"
assert "source_code" not in r, f"no element tree: {r['source_code']}"
assert r["front"].get("bundleId") == "local.pokimcp.fixture", f"front app: {r['front']}"
assert r.get("tap") == 1 and r.get("type") == 1, f"tap {r.get('tap')} type {r.get('type')}"
assert r.get("focus", {}).get("value") == sys.argv[2], f"focused field reads {r.get('focus')}"
PY
SHIFT="$(python3 -c 'import json,sys,re;v=json.load(open(sys.argv[1])).get("viewport","");m=re.findall(r"-?[0-9.]+",v);print(m[0],m[1]) if m else print("0 0")' "$DOCS/field.json")"
[ "$SHIFT" != "0 0" ] && echo "viewport origin: $SHIFT"
python3 "$HERE/compare.py" "$DOCS/field-after.xml" "$WORK/reference.json" $SHIFT
if [ "$MODE" = cycle ]; then echo "in-process close, reopen (generation $(python3 -c "import json;print(json.load(open('$DOCS/field.json'))['prepare2']['generation'])")), read, tap, type and read-back passed"; else echo "in-process read, tap, type and read-back passed"; fi
