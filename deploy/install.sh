#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Run with sudo' >&2; exit 1; }
id ubuntu >/dev/null || { echo 'The ubuntu user is required' >&2; exit 1; }

BASE=/opt/discord-voice-keeper
SOURCE=$BASE/source
REPO=https://github.com/SardorYusupov166/Discord-Voice-Keeper.git
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git

if ! command -v node >/dev/null || ! node -e 'const v=process.versions.node.split(".").map(Number); process.exit(v[0]===22 && v[1]>=13 ? 0 : 1)'; then
  setup=$(mktemp)
  trap 'rm -f "$setup"' EXIT
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "$setup"
  bash "$setup"
  apt-get install -y nodejs
fi
command -v npm >/dev/null || { echo 'npm is missing after Node.js installation' >&2; exit 1; }

install -d -m 755 "$BASE" "$BASE/releases"
install -d -m 700 -o ubuntu -g ubuntu "$BASE/data"
install -d -m 700 -o root -g root "$BASE/backups"
if [[ ! -d $SOURCE/.git ]]; then
  git clone --depth 1 --branch main "$REPO" "$SOURCE"
elif [[ $(git -C "$SOURCE" remote get-url origin) != "$REPO" ]]; then
  echo "Unexpected Git origin in $SOURCE" >&2
  exit 1
fi
git -C "$SOURCE" fetch --depth 1 origin main
git -C "$SOURCE" reset --hard FETCH_HEAD

if [[ ! -f $BASE/.env ]]; then
  install -m 600 -o ubuntu -g ubuntu /dev/null "$BASE/.env"
  cat >"$BASE/.env" <<'EOF'
DISCORD_TOKEN=
GUILD_ID=
VOICE_CHANNEL_ID=
EOF
fi
chown ubuntu:ubuntu "$BASE/.env"
chmod 600 "$BASE/.env"

install -m 644 "$SOURCE/deploy/discord-voice-keeper.service" /etc/systemd/system/discord-voice-keeper.service
systemctl daemon-reload
systemctl enable discord-voice-keeper.service
bash "$SOURCE/deploy/update.sh"
