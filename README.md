# Discord Voice Keeper

A minimal Discord bot that keeps a voice channel occupied without playing audio. Node.js 22+, discord.js and @discordjs/voice.

## Discord setup
1. Create an application and bot in [Discord Developer Portal](https://discord.com/developers/applications).
2. Invite with **View Channel**, **Connect** permissions. Enable **Guilds** and **Guild Voice States** gateway intents (non-privileged).
3. In Discord settings, enable Developer Mode and copy server ID and voice channel ID.
4. Copy `.env.example` to `.env` and fill `DISCORD_TOKEN`, `GUILD_ID`, `VOICE_CHANNEL_ID`. Never commit `.env`.

## Local run

```bash
npm install
npm start
```

## Oracle Ubuntu 22.04 (1 GB RAM)

SSH from your own machine using your private key (never upload it to GitHub).

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
git clone https://github.com/SardorYusupov166/Discord-Voice-Keeper.git
cd Discord-Voice-Keeper
sudo bash deploy/install.sh
sudo nano /opt/discord-voice-keeper/.env
sudo systemctl restart discord-voice-keeper
sudo systemctl status discord-voice-keeper --no-pager
sudo journalctl -u discord-voice-keeper -n 100 --no-pager
```

To update: `git pull` in the clone, then `sudo bash deploy/install.sh` and `sudo systemctl restart discord-voice-keeper`.

Uses outbound Discord connections only; no additional incoming ports required for bot traffic. A public IP and valid internet gateway route may be needed for SSH and outbound network on Oracle Cloud. The process is kept alive by systemd, subject to Oracle infrastructure availability.

**Security:** do not send tokens or SSH private keys in chat. `.env` stays on server. If running on a publicly visible cloud instance, restrict SSH inbound to your IP if practical.

## Troubleshooting
- `sudo journalctl -u discord-voice-keeper -f` for live logs.
- Verify bot is invited and has Connect/View Channel permissions, and the IDs are correct.
- For voice libraries that require optional crypto dependencies, install the dependency recommended by your installed `@discordjs/voice` version.
