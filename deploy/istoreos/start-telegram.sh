#!/bin/sh
# Start (or restart) the Poki Telegram channel worker on an iStoreOS router.
# Usage: sh start-telegram.sh [--check]
set -eu
umask 077

BASE_DIR=${BASE_DIR:-/mnt/data/poki}
TOKEN_FILE=${TOKEN_FILE:-$BASE_DIR/telegram-token}
CONF_DIR=${CONF_DIR:-$BASE_DIR/telegram}
ENV_FILE=${ENV_FILE:-$CONF_DIR/telegram.env}
# Model credentials, either an API key (`"auth": "api-key"`) or a sign-in file (`"auth": "chatgpt"`).
# See the README section. The sign-in has to stay writable: the agent refreshes its token and writes
# the file back, so a read-only mount turns the next refresh into "Credential store modify failed".
# It lives in $CONF_DIR, which is already mounted read-write at /tg.
KEY_FILE=${KEY_FILE:-$BASE_DIR/openai-key}
AUTH_FILE=${AUTH_FILE:-$CONF_DIR/auth.json}

if [ ! -s "$TOKEN_FILE" ]; then
  echo "Missing $TOKEN_FILE (one bot token per file, chmod 600)." >&2
  exit 1
fi
if [ ! -s "$CONF_DIR/telegram.json" ]; then
  echo "Missing $CONF_DIR/telegram.json" >&2
  exit 1
fi

mkdir -p "$CONF_DIR/state"
chmod 700 "$CONF_DIR" "$CONF_DIR/state"

# `docker run -e` puts these values on the command line, where shell history and `ps` keep
# them. The env file does not hide them from `docker inspect` (Config.Env still lists them),
# but anyone who can run docker here can read the files they came from anyway.
{
  echo "POKI_MCP_STATE_DIR=/state"
  echo "HOME=/root"
  echo "TELEGRAM_BOT_TOKEN=$(cat "$TOKEN_FILE")"
} > "$ENV_FILE"
# The container has no shell of yours, so the model credential has to be handed over here.
if [ -s "$KEY_FILE" ]; then
  echo "OPENAI_API_KEY=$(cat "$KEY_FILE")" >> "$ENV_FILE"
fi
if [ -s "$AUTH_FILE" ]; then
  chmod 600 "$AUTH_FILE"
  # The file is at $CONF_DIR/auth.json, which $CONF_DIR already carries to /tg. Mounting it again
  # read-only would break the refresh write, and mounting it read-write at a second path over the
  # same directory is fragile, so it is not mounted separately at all.
  echo "POKI_AGENT_AUTH_FILE=/tg/auth.json" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

if [ ! -s "$KEY_FILE" ] && [ ! -s "$AUTH_FILE" ]; then
  if grep -q '"auth"[[:space:]]*:[[:space:]]*"chatgpt"' "$CONF_DIR/telegram.json" 2>/dev/null; then
    echo "telegram.json says auth=chatgpt but $AUTH_FILE does not exist. It is mounted as /tg/auth.json; --check passes without it, the first message fails." >&2
  else
    echo "No model credential: create $KEY_FILE (chmod 600) with an API key, or $AUTH_FILE with a chatgpt sign-in. --check passes without one; the first message fails." >&2
  fi
fi

docker rm -f poki-telegram >/dev/null 2>&1 || true
# Container PIDs are reused across restarts, so a stale lock looks "alive" to the
# worker's kill(pid, 0) probe. Removing it is safe: the only worker that could
# hold it was just stopped above.
rm -f "$CONF_DIR/state/messages.lock"

docker run -d --name poki-telegram \
  --network host \
  --restart unless-stopped \
  -v "$BASE_DIR/src":/app -w /app \
  -v "$BASE_DIR/state":/state \
  -v "$BASE_DIR/agent-config":/root/.config/poki-agent \
  -v "$CONF_DIR":/tg \
  --env-file "$ENV_FILE" \
  poki:linux node agent/telegram.mjs --config /tg/telegram.json --state /tg/state "$@" >/dev/null

sleep 6
docker ps --filter name=poki-telegram --format "{{.Names}} {{.Status}}"
echo "--- log ---"
docker logs poki-telegram 2>&1 | tail -20
