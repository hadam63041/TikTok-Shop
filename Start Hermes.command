#!/bin/zsh
# Double-click this file to launch Hermes Command (agent + dashboard).
# It uses the Node.js bundled in .tools/ — no system install required.

cd "$(dirname "$0")/HermesAgent" || exit 1

NODE_BIN="$(cd ../.tools/node-v22.12.0-darwin-arm64/bin && pwd)"
export PATH="$NODE_BIN:$PATH"

PORT="${PORT:-8787}"
HTTPS_PORT="${HTTPS_PORT:-8443}"

# Prefer HTTPS when a TLS cert is present (generate one — see README), else HTTP.
if [ -f ".cert/cert.pem" ] && [ -f ".cert/key.pem" ]; then
  URL="https://localhost:$HTTPS_PORT"
else
  URL="http://localhost:$PORT"
fi

echo "⚡ Starting Hermes Command on $URL"
echo "   (close this window or press Ctrl-C to stop)"
echo ""

# Open the dashboard in the default browser once the server is up (-k: allow the
# self-signed localhost cert).
( for i in {1..30}; do
    if curl -sk "$URL/api/health" >/dev/null 2>&1; then
      open "$URL"
      break
    fi
    sleep 0.5
  done ) &

exec node server.js
