#!/usr/bin/env bash
# Puts one Poki build into a channel's rolling prerelease (app-prealpha-latest or app-alpha-latest)
# and tags its commit app-<version>-<channel>.<build>, the record of what was built. Poki Setup reads
# the channel from the release's tag and the version from the IPA's name (docs/release-channels.md).
# Until every Poki Setup reads app-* tags, the same files also go to the old ios-<channel>-latest
# release, which Poki Setup 0.2.2 and earlier read.
#
#   publish-rolling.sh <prealpha|alpha> <version> <build> <dir with Poki-external-unsigned.ipa and Poki-signing.zip> [desktop source release]
#
# Run from the checkout of the built commit with GH_TOKEN set. New files go up before the previous
# build's are removed, so the release always has an installable IPA. With a desktop source release
# (alpha takes app-prealpha-latest's), its Poki Setup files are copied in as well.
set -euo pipefail
CHANNEL="$1" VERSION="$2" BUILD="$3" SRC="$4" DESKTOP_FROM="${5:-}"
case "$CHANNEL" in
  prealpha) TITLE=Pre-alpha; BLURB="An untested snapshot of main for the Pre-alpha channel in Poki Setup; it can break." ;;
  alpha) TITLE=Alpha; BLURB="A pre-alpha that passed the alpha tests, for the Alpha channel in Poki Setup; expect rough edges." ;;
  *) echo "::error::channel is prealpha or alpha"; exit 2 ;;
esac
ROLLING="app-$CHANNEL-latest"
LEGACY="ios-$CHANNEL-latest"
TAG="app-$VERSION-$CHANNEL.$BUILD"
SHA="$(git rev-parse HEAD)"
git config user.name >/dev/null || git config user.name "github-actions[bot]"
git config user.email >/dev/null || git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

rm -rf dist && mkdir dist
if [ -f "$SRC/Poki-unsigned.ipa" ]; then cp "$SRC/Poki-unsigned.ipa" "dist/Poki-$VERSION-$BUILD.ipa"; fi
cp "$SRC/Poki-external-unsigned.ipa" "dist/Poki-external-$VERSION-$BUILD.ipa"
cp "$SRC/Poki-signing.zip" dist/
# The relay Worker from this commit, so Poki Setup deploys the relay that matches this build.
cp deploy/cf-relay/worker.js dist/poki-relay-worker.js
(cd dist && sha256sum *.ipa poki-relay-worker.js > SHA256SUMS && cat SHA256SUMS)

if [ -n "$DESKTOP_FROM" ]; then
  gh release download "$DESKTOP_FROM" --dir dist --pattern 'PokiSetup-*' --pattern 'SHA256SUMS-desktop.txt' || echo "::warning::no Poki Setup files on $DESKTOP_FROM"
fi

# What changed since the previous build on this channel.
previous="$(git tag --list "app-*-$CHANNEL.*" "ios-$CHANNEL-*" --sort=-creatordate | grep -vx "$TAG" | grep -vx "$LEGACY" | head -1 || true)"
if [ -n "$previous" ] && git merge-base --is-ancestor "$previous" HEAD 2>/dev/null; then
  range="$previous..HEAD"; since="since $previous"
else
  range="-15"; since="(latest commits)"
fi
{
  echo "$TITLE: Poki $VERSION ($BUILD), built from ${SHA:0:7} (tag $TAG). $BLURB Use the Beta or Stable channel for anything you rely on. This release is updated in place with every $TITLE build."
  echo
  echo "Install Poki-external with Poki Setup, or sign either IPA with your own tool (entitlements in Poki-signing.zip). See native/ios-app/README.md."
  echo
  echo "Relay: Poki Setup's Update Relay deploys this release's relay Worker. To update it yourself, download [poki-relay-worker.js](https://github.com/$GITHUB_REPOSITORY/releases/download/$ROLLING/poki-relay-worker.js) (SHA-256 in SHA256SUMS), open your poki-relay Worker in the Cloudflare dashboard, choose Edit code, replace everything with this file and deploy. For a new relay, use deploy/cf-relay/deploy.sh."
  echo
  echo "### Changes $since"
  git log --no-merges --format='- %s (%h)' $range | head -60
} > notes.md

# The versioned tag first: if it cannot be made, nothing is published.
existing="$(git ls-remote --tags origin "refs/tags/$TAG^{}" | cut -f1)"
if [ -n "$existing" ]; then
  # A re-run of the same build is fine; the same name on another commit is not.
  [ "$existing" = "$SHA" ] || { echo "::error::$TAG already names $existing, not $SHA"; exit 1; }
else
  git tag -a "$TAG" -m "Poki $VERSION ($BUILD) $TITLE" "$SHA"
  git push origin "refs/tags/$TAG"
fi

# Replaces the files of one rolling release (made on first use) with this build's.
publish_to() {
  local rel="$1" old new count
  sed "s#/releases/download/$ROLLING/#/releases/download/$rel/#" notes.md > "notes-$rel.md"
  if gh release view "$rel" >/dev/null 2>&1; then
    old="$(gh release view "$rel" --json assets --jq '.assets[].name')"
    gh release upload "$rel" dist/* --clobber
    # The previous build's files that this one did not replace (they carry the old build number).
    new="$(find dist -maxdepth 1 -type f -exec basename {} \;)"
    # Poki Setup's files are replaced only when this build brings some: a pre-alpha, or an alpha whose
    # pre-alpha had none, keeps the ones already there, which older Poki Setups update from.
    stale='^Poki-.*\.ipa$'
    compgen -G "dist/PokiSetup-*" >/dev/null && stale='^(Poki-.*\.ipa|PokiSetup-.*)$'
    echo "$old" | grep -E "$stale" | grep -vxF -f <(echo "$new") | while read -r name; do
      gh release delete-asset "$rel" "$name" --yes
    done
    gh release edit "$rel" --title "Poki v$VERSION ($BUILD) $TITLE" --notes-file "notes-$rel.md" --prerelease --latest=false
    git tag -f "$rel" "$SHA" && git push -f origin "refs/tags/$rel" || echo "::warning::$rel was not moved; the release's files are updated"
  else
    gh release create "$rel" dist/* --target "$SHA" --draft \
      --title "Poki v$VERSION ($BUILD) $TITLE" --notes-file "notes-$rel.md" --prerelease --latest=false
    count="$(find dist -maxdepth 1 -type f | wc -l)"
    test "$(gh release view "$rel" --json assets --jq '.assets | length')" -eq "$count"
    gh release edit "$rel" --draft=false --prerelease --latest=false
  fi
  echo "Published Poki v$VERSION ($BUILD) to $rel: https://github.com/$GITHUB_REPOSITORY/releases/tag/$rel"
}
publish_to "$ROLLING"
publish_to "$LEGACY"
