#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example and set AI/tailnet values." >&2
  exit 2
fi

TAG=$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)
TAILSCALE_IP=$(sed -n 's/^TAILSCALE_IP=//p' .env | tail -1)
WEB_PORT=$(sed -n 's/^WEB_PORT=//p' .env | tail -1)
TAILSCALE_IP=${TAILSCALE_IP:-100.87.23.114}
WEB_PORT=${WEB_PORT:-8090}

TAG="$TAG" docker compose --env-file .env -f deploy/docker-compose.yml up --build -d
docker compose --env-file .env -f deploy/docker-compose.yml ps
echo "Web: http://${TAILSCALE_IP}:${WEB_PORT}"
echo "API: internal Compose network only"
