#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run with sudo' >&2; exit 1; }
BASE=/opt/discord-voice-keeper
SOURCE=$BASE/source
REPO=https://github.com/SardorYusupov166/Discord-Voice-Keeper.git
UNIT=discord-voice-keeper.service
[[ -d $SOURCE/.git && -f $BASE/.env ]] || { echo 'Run deploy/install.sh first' >&2; exit 1; }
[[ -d $BASE/data ]] || { echo 'Missing persistent data directory; run deploy/install.sh' >&2; exit 1; }
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
  ln -s "$BASE/data" "$stage/data"
  chown -R root:root "$stage"
  chmod -R go-w "$stage"
  chmod 755 "$stage"
  mv -- "$stage" "$release"
  trap - EXIT
fi

previous=$(readlink -f "$BASE/current" 2>/dev/null || true)
[[ $previous != "$release" ]] || { echo "Already running $commit"; exit 0; }
if [[ -n $previous && -d $previous ]]; then
  rm -f -- "$BASE/.previous-next"
  ln -s "$previous" "$BASE/.previous-next"
  mv -Tf "$BASE/.previous-next" "$BASE/previous"
fi
install -d -m 700 -o root -g root "$BASE/backups"
backup=$BASE/backups/$(date -u +%Y%m%dT%H%M%SZ)-$commit.tar.gz
tar -C "$BASE" -czf "$backup" .env data
chmod 600 "$backup"
echo "Backup saved: $backup"
expected_guilds=$(node -e 'const fs=require("fs"); const p=process.argv[1]; if(fs.existsSync(p)){const x=JSON.parse(fs.readFileSync(p)); for(const [id,s] of Object.entries(x.guilds)) if(s.autojoin && s.channelId) console.log(id)}' "$BASE/data/guilds.json")
if [[ ! -f $BASE/data/guilds.json ]]; then
  legacy_guild=$(sed -nE 's/^GUILD_ID=([0-9]{17,20})$/\1/p' "$BASE/.env" | head -n 1)
  legacy_channel=$(sed -nE 's/^VOICE_CHANNEL_ID=([0-9]{17,20})$/\1/p' "$BASE/.env" | head -n 1)
  if [[ -n $legacy_guild && -n $legacy_channel ]]; then expected_guilds=$legacy_guild; fi
fi
rm -f -- "$BASE/.current-next"
ln -s "$release" "$BASE/.current-next"
mv -Tf "$BASE/.current-next" "$BASE/current"
install -m 644 "$release/deploy/discord-voice-keeper.service" /etc/systemd/system/discord-voice-keeper.service
systemctl daemon-reload

if ! grep -Eq '^DISCORD_TOKEN=.+$' "$BASE/.env"; then
  echo "Installed $commit. Set DISCORD_TOKEN in $BASE/.env, then run: sudo systemctl start $UNIT"
  exit 0
fi

started_at=$(date --iso-8601=seconds)
systemctl restart "$UNIT"
for ((i=0; i<45; i++)); do
  recent=$(journalctl -u "$UNIT" --since "$started_at" -o cat --no-pager)
  if grep -q 'COMMANDS_REGISTERED' <<<"$recent"; then
    ready=true
    for guild_id in $expected_guilds; do
      if ! grep -q "VOICE_READY guild=$guild_id " <<<"$recent"; then ready=false; break; fi
    done
    if [[ $ready == true ]]; then
      echo "Updated to $commit; commands and configured voice connections confirmed"
      exit 0
    fi
  fi
  sleep 1
done

echo "New release did not report command registration and all configured voice connections within 45 seconds" >&2
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
