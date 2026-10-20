#!/usr/bin/env bash
# Full browser smoke test on fresh DEMO data (fictional candidate and employers; nothing real, nothing sent anywhere).
# Requires a production build (`npm run build`) and Chromium (Playwright's, via PLAYWRIGHT_BROWSERS_PATH or /opt/pw-browsers).
set -euo pipefail
PORT="${PORT:-3111}"
DATA="$(mktemp -d)"
export AGENT_DATA_DIR="$DATA" AGENT_ACCESS_PASSWORD="demo-password-12345" AGENT_SESSION_SECRET="0123456789abcdef0123456789abcdef0123"
npx tsx scripts/seed-demo.ts
npx next start -p "$PORT" >"$DATA/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; rm -rf "$DATA"' EXIT
for _ in $(seq 1 40); do curl -fs -o /dev/null "http://localhost:$PORT/agent/login" && break; sleep 0.5; done
BASE_URL="http://localhost:$PORT" npx tsx scripts/e2e-smoke.mts
