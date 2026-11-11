#!/bin/bash
# app-tests.sh SIMULATOR_UDID [DERIVED_DATA]: builds PokiTests and runs it inside Poki on a booted
# iOS simulator. The bundle is injected into Poki at launch (libXCTestBundleInject) instead of going
# through `xcodebuild test`, whose runner connection hangs on some Xcode and simulator pairs.
set -euo pipefail
UDID="$1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DD="${2:-$APP_DIR/../../build/app-tests}"
X="$(xcode-select -p)/Platforms/iPhoneSimulator.platform/Developer"

xcodegen generate --spec "$APP_DIR/project.yml" >/dev/null
xcodebuild -quiet build-for-testing -project "$APP_DIR/Poki.xcodeproj" -scheme Poki \
  -destination "id=$UDID" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=
APP="$DD/Build/Products/Debug-iphonesimulator/Poki.app"
BUNDLE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl install "$UDID" "$APP"
# Setup's last item needs location; the tests check a phone with every item done.
xcrun simctl privacy "$UDID" grant location-always "$BUNDLE"
xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true

# PokiTests read the English text, as on CI's simulator, whatever language this Mac's simulator uses.
LOG="$(mktemp)"
trap 'rm -f "$LOG"; xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true' EXIT
SIMCTL_CHILD_DYLD_INSERT_LIBRARIES="$X/usr/lib/libXCTestBundleInject.dylib" \
SIMCTL_CHILD_XCTestBundlePath="$APP/PlugIns/PokiTests.xctest" \
SIMCTL_CHILD_DYLD_FRAMEWORK_PATH="$X/Library/Frameworks:$X/Library/PrivateFrameworks" \
SIMCTL_CHILD_DYLD_LIBRARY_PATH="$X/usr/lib" \
  timeout 300 xcrun simctl launch --console-pty "$UDID" "$BUNDLE" -AppleLanguages "(en)" -AppleLocale en_US >"$LOG" 2>&1 || true
grep -E "^Test Case|error:|Executed" "$LOG" || true
grep -q "Test Suite 'All tests' passed" "$LOG"
