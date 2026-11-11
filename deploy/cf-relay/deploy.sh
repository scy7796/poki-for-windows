#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Deploys your own Poki relay to your own Cloudflare account, then prints the relay address to
# enter in Poki (Connect > Relay address). Poki has no default relay: traffic goes only through a
# Worker you control.
#
#   ./deploy.sh                              # https://poki-relay.<your subdomain>.workers.dev
#   ./deploy.sh --domain relay.example.com   # a hostname on a zone in your account
#   ./deploy.sh --dry-run                    # build and check only; nothing is uploaded
set -euo pipefail

name=poki-relay
domain=
dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) domain=${2:?--domain needs a hostname, such as relay.example.com}; shift 2 ;;
    --name) name=${2:?--name needs a Worker name}; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
case "$domain" in
  */*|*:*) echo "--domain takes a bare hostname, such as relay.example.com" >&2; exit 2 ;;
esac

cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is required (https://nodejs.org)." >&2; exit 1; }
[ -d node_modules/wrangler ] || npm ci --no-audit --no-fund
wrangler() { npx --no-install wrangler "$@"; }

if [ "$dry_run" = 1 ]; then
  wrangler deploy --dry-run --outdir dist --name "$name"
  echo "Dry run: the Worker builds. Nothing was uploaded."
  exit 0
fi

if ! wrangler whoami --json >/dev/null 2>&1; then
  echo "Sign in to Cloudflare first: npx wrangler login (or set CLOUDFLARE_API_TOKEN), then run ./deploy.sh again." >&2
  exit 1
fi

# TOKEN_SECRET signs OAuth tokens. It is made once on the first deploy; a later deploy keeps it,
# because changing it signs every MCP client out.
secrets=
cleanup() { [ -n "$secrets" ] && rm -f "$secrets"; return 0; }
trap cleanup EXIT INT TERM
if ! wrangler secret list --name "$name" --format json 2>/dev/null | grep -q '"TOKEN_SECRET"'; then
  secrets=$(mktemp)
  chmod 600 "$secrets"
  printf '{"TOKEN_SECRET":"%s"}\n' "$(openssl rand -hex 32)" > "$secrets"
  echo "First deploy of $name: a new TOKEN_SECRET is made and uploaded with it."
fi

set -- deploy --name "$name"
[ -n "$domain" ] && set -- "$@" --domain "$domain"
[ -n "$secrets" ] && set -- "$@" --secrets-file "$secrets"
log=$(mktemp)
if ! wrangler "$@" 2>&1 | tee "$log"; then
  rm -f "$log"
  echo "Wrangler did not deploy the relay; its message is above." >&2
  exit 1
fi

if [ -n "$domain" ]; then
  address="https://$domain"
else
  address=$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$log" | head -n 1)
fi
rm -f "$log"
if [ -z "$address" ]; then
  echo "Deployed, but the address was not in Wrangler's output. Find it under Workers & Pages > $name in the Cloudflare dashboard." >&2
  exit 1
fi
echo
echo "Your relay: $address"
echo "In Poki on the iPhone, open Connect, tap Relay address, and enter it."
echo "Check it any time with: node test/phone-sim.mjs $address --check"
