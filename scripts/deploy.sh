#!/usr/bin/env bash
# Ships Clocked to the home server, rebuilds the container, and serves it over
# Tailscale HTTPS on :8443. Run from Git Bash: bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=${CLOCKED_SSH:-ubui1}
DIR=${CLOCKED_DIR:-clocked}

npm run typecheck
npm test

echo "Copying source to $HOST:~/$DIR"
tar czf - --exclude=node_modules --exclude=dist --exclude=data --exclude=.git --exclude=.playwright-mcp --exclude=.env --exclude=.env.local . \
  | ssh "$HOST" "mkdir -p ~/$DIR/data && tar xzf - -C ~/$DIR"

echo "Building and starting the container"
ssh "$HOST" "cd ~/$DIR && docker compose up -d --build && docker image prune -f >/dev/null"

echo "Waiting for the server"
ssh "$HOST" 'for i in $(seq 1 40); do curl -sf http://127.0.0.1:8787/api/health >/dev/null && exit 0; sleep 1; done; docker logs --tail 40 clocked; exit 1'

echo "Serving over Tailscale"
ssh "$HOST" "docker exec tailscale tailscale serve --bg --https=8443 http://127.0.0.1:8787 >/dev/null"
ssh "$HOST" "docker exec tailscale tailscale serve status" | grep 8443
