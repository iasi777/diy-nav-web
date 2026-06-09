#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

docker compose -f deploy/docker-compose.yml down
docker image rm diy-nav-web:latest diy-nav-api:latest 2>/dev/null || true
docker image prune -f

echo "Persistent volumes diy-nav-data and diy-nav-backups were preserved."
