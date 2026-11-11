FROM node:24-bookworm-slim

# devices.py talks to /var/run/usbmuxd over a unix socket; prepare-remote.mjs also needs python3.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV POKI_MCP_STATE_DIR=/state
EXPOSE 47825
