#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo "Run with sudo"; exit 1; fi
command -v node >/dev/null || { echo "Install Node.js 22 first"; exit 1; }
command -v npm >/dev/null || { echo "Install npm first"; exit 1; }
id ubuntu >/dev/null || { echo "Missing ubuntu user"; exit 1; }
DIR=/opt/discord-voice-keeper
install -d -m 755 "$DIR"
cp package.json "$DIR/"
cp -r src "$DIR/"
cd "$DIR"
npm install --omit=dev --no-audit --no-fund
if [[ ! -f .env ]]; then
  install -m 600 -o ubuntu -g ubuntu /dev/null .env
  echo "Created $DIR/.env; configure DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID before starting"
fi
chown -R ubuntu:ubuntu "$DIR"
chmod 600 "$DIR/.env"
install -m 644 "$OLDPWD/deploy/discord-voice-keeper.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable discord-voice-keeper.service
echo "Edit $DIR/.env securely, then run sudo systemctl restart discord-voice-keeper"
