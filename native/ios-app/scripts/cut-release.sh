#!/usr/bin/env bash
# Cuts a Poki Alpha or Pre-alpha: tags a commit app-<VERSION>-<alpha|prealpha>.<commit count> and
# pushes the tag, which starts .github/workflows/channel-release.yml (build, then a GitHub prerelease).
# The commit must already be on the remote and must contain channel-release.yml. Beta and Stable
# releases are promotions (propose-promotion.yml); see docs/release-channels.md. Pre-alphas now build on
# every merge into main (prealpha.yml); this script is the fallback.
#
#   native/ios-app/scripts/cut-release.sh alpha|pre-alpha [ref] [remote]   # defaults: origin/poki/ios-integration, origin
#   DRY_RUN=1 native/ios-app/scripts/cut-release.sh pre-alpha              # print the tag, push nothing
set -euo pipefail

case "${1:-}" in
  alpha) channel=alpha; title=Alpha ;;
  pre-alpha|prealpha) channel=prealpha; title=Pre-alpha ;;
  *) echo "usage: $0 alpha|pre-alpha [ref] [remote]" >&2; exit 2 ;;
esac
remote="${3:-origin}"
ref="${2:-$remote/poki/ios-integration}"
git fetch --quiet "$remote" --tags
git fetch --quiet "$remote" "+refs/heads/*:refs/remotes/$remote/*"

sha="$(git rev-parse --verify "$ref^{commit}")"
git cat-file -e "$sha:.github/workflows/channel-release.yml" 2>/dev/null || { echo "$ref has no .github/workflows/channel-release.yml, so a tag there would build nothing." >&2; exit 1; }
if ! git branch -r --contains "$sha" | grep -q "^ *$remote/"; then
  echo "$sha is not on $remote yet. Push it first." >&2; exit 1
fi
version="$(git show "$sha:native/ios-app/VERSION" | tr -d ' \n')"
build="$(git rev-list --count "$sha")"
tag="app-$version-$channel.$build"
old_tag="ios-$channel-$version-$build"

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null || git rev-parse -q --verify "refs/tags/$old_tag" >/dev/null; then
  echo "$tag already exists (this commit, or one with the same count, was already cut)." >&2; exit 1
fi
echo "Poki $version ($build) from $(git log -1 --format='%h %s' "$sha")"
echo "tag: $tag"
[ "${DRY_RUN:-}" = 1 ] && exit 0
git tag -a "$tag" -m "Poki v$version ($build) $title" "$sha"
git push "$remote" "refs/tags/$tag"
echo "Pushed. Follow the build under Actions > Alpha and pre-alpha."
