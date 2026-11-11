#!/bin/bash
# Makes the asset catalogs from docs/images/poki-icon.png (macOS, needs swift): the app icon (the bear
# full-bleed: the logo flattened on brand blue, no margin; iOS applies its own corner mask) and the Bear image for the app and the Live Activity. They are generated, not
# checked in, so the one source image stays the only copy. Run before xcodegen.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ICON="$ROOT/docs/images/poki-icon.png"
COMPOSE="$ROOT/native/ios-runner/branding/compose.swift"
BLUE="#2084FD"
meta='{"info":{"version":1,"author":"poki"}}'

catalog() { rm -rf "$1"; mkdir -p "$1"; echo "$meta" > "$1/Contents.json"; }
bear() {
  mkdir -p "$1/Bear.imageset"
  swift "$COMPOSE" "$ICON" "$1/Bear.imageset/bear@3x.png" 360 1.0
  echo '{"images":[{"filename":"bear@3x.png","idiom":"universal","scale":"3x"}],"info":{"version":1,"author":"poki"}}' > "$1/Bear.imageset/Contents.json"
}

APP="$HERE/Poki/Assets.xcassets"
catalog "$APP"
mkdir -p "$APP/AppIcon.appiconset"
swift "$COMPOSE" "$ICON" "$APP/AppIcon.appiconset/icon-1024.png" 1024 1.0 "$BLUE"
echo '{"images":[{"filename":"icon-1024.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"version":1,"author":"poki"}}' > "$APP/AppIcon.appiconset/Contents.json"
mkdir -p "$APP/AccentColor.colorset"
echo '{"colors":[{"idiom":"universal","color":{"color-space":"srgb","components":{"red":"0x20","green":"0x84","blue":"0xFD","alpha":"1.000"}}}],"info":{"version":1,"author":"poki"}}' > "$APP/AccentColor.colorset/Contents.json"
bear "$APP"
# Provider logos (Poki/ProviderIcons, see its README) as vector template images.
logos() {
  for svg in "$HERE"/Poki/ProviderIcons/*.svg; do
    name="Provider-$(basename "$svg" .svg)"
    mkdir -p "$1/$name.imageset"
    cp "$svg" "$1/$name.imageset/logo.svg"
    echo '{"images":[{"filename":"logo.svg","idiom":"universal"}],"info":{"version":1,"author":"poki"},"properties":{"preserves-vector-representation":true,"template-rendering-intent":"template"}}' > "$1/$name.imageset/Contents.json"
  done
}
logos "$APP"
# Proxy apps' own App Store icons (Poki/ProxyIcons, see its README) beside their names in Setup.
for png in "$HERE"/Poki/ProxyIcons/*.png; do
  name="Proxy-$(basename "$png" .png)"
  mkdir -p "$APP/$name.imageset"
  cp "$png" "$APP/$name.imageset/icon@3x.png"
  echo '{"images":[{"filename":"icon@3x.png","idiom":"universal","scale":"3x"}],"info":{"version":1,"author":"poki"}}' > "$APP/$name.imageset/Contents.json"
done

WIDGET="$HERE/PokiWidgets/Assets.xcassets"
catalog "$WIDGET"
bear "$WIDGET"
# The calling agent's logo on the Live Activity.
logos "$WIDGET"
echo "assets in $APP and $WIDGET"
