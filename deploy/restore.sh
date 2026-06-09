#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /backups/diy-nav-<timestamp>.sqlite" >&2
  exit 2
fi

cd "$(dirname "$0")"
docker compose stop api
docker compose run --rm --no-deps api node dist/src/scripts/restore.js "$1"
docker compose up -d api
docker compose up -d web
