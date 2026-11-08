#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run with sudo' >&2; exit 1; }
BASE=/opt/discord-voice-keeper
SOURCE=$BASE/source
REPO=https://github.com/SardorYusupov166/Discord-Voice-Keeper.git
UNIT=discord-voice-keeper.service
[[ -d $SOURCE/.git && -f $BASE/.env ]] || { echo 'Run deploy/install.sh first' >&2; exit 1; }
[[ $(git -C "$SOURCE" remote get-url origin) == "$REPO" ]] || { echo 'Unexpected Git origin' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm is required' >&2; exit 1; }

git -C "$SOURCE" fetch --depth 1 origin main
commit=$(git -C "$SOURCE" rev-parse FETCH_HEAD)
release=$BASE/releases/$commit
if [[ ! -d $release ]]; then
  stage=$(mktemp -d "$BASE/releases/.build.XXXXXXXX")
  trap 'rm -rf -- "$stage"' EXIT
  git -C "$SOURCE" archive "$commit" | tar -x -C "$stage"
  [[ -f $stage/package-lock.json ]] || { echo 'package-lock.json is required' >&2; exit 1; }
  chown -R ubuntu:ubuntu "$stage"
  runuser -u ubuntu -- npm ci --prefix "$stage" --omit=dev --no-audit --no-fund
  node --check "$stage/src/index.js"
  ln -s "$BASE/.env" "$stage/.env"
  chown -R root:root "$stage"
  chmod -R go-w "$stage"
  mv -- "$stage" "$release"
  trap - EXIT
fi

previous=$(readlink -f "$BASE/current" 2>/dev/null || true)
[[ $previous != "$release" ]] || { echo "Already running $commit"; exit 0; }
rm -f -- "$BASE/.current-next"
ln -s "$release" "$BASE/.current-next"
mv -Tf "$BASE/.current-next" "$BASE/current"
install -m 644 "$release/deploy/discord-voice-keeper.service" /etc/systemd/system/discord-voice-keeper.service
systemctl daemon-reload

configured=true
for name in DISCORD_TOKEN GUILD_ID VOICE_CHANNEL_ID; do
  grep -Eq "^${name}=.+$" "$BASE/.env" || configured=false
done
if [[ $configured != true ]]; then
  echo "Installed $commit. Set DISCORD_TOKEN, GUILD_ID and VOICE_CHANNEL_ID in $BASE/.env, then run: sudo systemctl start $UNIT"
  exit 0
fi

started_at=$(date --iso-8601=seconds)
systemctl restart "$UNIT"
for ((i=0; i<45; i++)); do
  if journalctl -u "$UNIT" --since "$started_at" -o cat --no-pager | grep -q 'VOICE_READY'; then
    echo "Updated to $commit; voice connection confirmed"
    exit 0
  fi
  sleep 1
done

echo "New release did not report VOICE_READY within 45 seconds" >&2
if [[ -n $previous && -d $previous ]]; then
  ln -s "$previous" "$BASE/.current-next"
  mv -Tf "$BASE/.current-next" "$BASE/current"
  install -m 644 "$previous/deploy/discord-voice-keeper.service" /etc/systemd/system/discord-voice-keeper.service
  systemctl daemon-reload
  systemctl restart "$UNIT"
  echo "Rolled back to $previous" >&2
else
  systemctl stop "$UNIT"
  echo 'No previous release is available; check journalctl for diagnostics' >&2
fi
exit 1
