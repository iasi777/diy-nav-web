#!/usr/bin/env sh
set -eu

REMOTE="${DIY_NAV_REMOTE:-root@100.87.23.114}"
DEST="${DIY_NAV_LOCAL_BACKUP_DIR:-$HOME/backups/diy-nav}"
mkdir -p "$DEST"

tailscale ssh "$REMOTE" "docker exec diy-nav-api tar -C /backups -cf - ." | tar -C "$DEST" -xf -

find "$DEST" -type f -name 'diy-nav-*.sqlite' -printf '%T@ %p\n' \
  | sort -nr \
  | awk 'NR > 12 { print $2 }' \
  | while IFS= read -r snapshot; do
      base=${snapshot%.sqlite}
      rm -f "$base.sqlite" "$base.json" "$base.sha256"
    done
