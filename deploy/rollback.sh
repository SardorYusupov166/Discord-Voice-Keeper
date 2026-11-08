#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run with sudo' >&2; exit 1; }
BASE=/opt/discord-voice-keeper
UNIT=discord-voice-keeper.service
target=$(readlink -f "$BASE/previous" 2>/dev/null || true)
[[ -n $target && -d $target && $target == "$BASE/releases/"* ]] || {
  echo 'No previous release is available' >&2
  exit 1
}
current=$(readlink -f "$BASE/current")
[[ $current != "$target" ]] || { echo 'Previous release is already active'; exit 0; }
node --check "$target/src/index.js"
backup=$BASE/backups/rollback-$(date -u +%Y%m%dT%H%M%SZ).tar.gz
tar -C "$BASE" -czf "$backup" .env data
chmod 600 "$backup"
rm -f -- "$BASE/.current-next" "$BASE/.previous-next"
ln -s "$target" "$BASE/.current-next"
ln -s "$current" "$BASE/.previous-next"
mv -Tf "$BASE/.current-next" "$BASE/current"
mv -Tf "$BASE/.previous-next" "$BASE/previous"
install -m 644 "$target/deploy/discord-voice-keeper.service" /etc/systemd/system/$UNIT
systemctl daemon-reload
systemctl restart "$UNIT"
echo "Rolled back to $target. Data backup: $backup"
