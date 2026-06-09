#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
docker compose exec -T api node dist/src/scripts/backup.js
