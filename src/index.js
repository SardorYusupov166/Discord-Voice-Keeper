import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus } from "@discordjs/voice";

const { DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID } = process.env;
if (![DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID].every(Boolean)) {
  console.error("Set DISCORD_TOKEN, GUILD_ID and VOICE_CHANNEL_ID in .env");
  process.exit(1);
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let timer = null;
let checking = false;
let shuttingDown = false;
let retryMs = 5000;

function schedule(delay = retryMs) {
  if (shuttingDown || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void ensureConnection();
  }, delay);
  timer.unref?.();
}

async function ensureConnection() {
  if (checking || shuttingDown || !client.isReady()) return;
  checking = true;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(VOICE_CHANNEL_ID);
    if (!channel || !channel.isVoiceBased() || channel.guildId !== GUILD_ID) throw new Error("Target is not a voice channel in the configured guild");
    let connection = getVoiceConnection(GUILD_ID);
    if (connection && connection.joinConfig.channelId !== VOICE_CHANNEL_ID) {
      connection.destroy();
      connection = undefined;
    }
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
      connection = joinVoiceChannel({
        channelId: VOICE_CHANNEL_ID,
        guildId: GUILD_ID,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
      });
      connection.on("error", (error) => console.error("Voice connection error:", error));
      connection.on("stateChange", (_oldState, newState) => {
        console.log("Voice state:", newState.status);
        if ([VoiceConnectionStatus.Disconnected, VoiceConnectionStatus.Destroyed].includes(newState.status)) schedule(5000);
      });
    }
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    retryMs = 5000;
    console.log("Connected to voice channel", VOICE_CHANNEL_ID);
  } catch (error) {
    console.error("Connection attempt failed:", error);
    retryMs = Math.min(Math.round(retryMs * 1.5), 60000);
  } finally {
    checking = false;
    schedule(30000);
  }
}

client.on("ready", () => {
  console.log("Logged in as", client.user.tag);
  void ensureConnection();
});
client.on("voiceStateUpdate", (oldState, newState) => {
  if (oldState.id === client.user?.id || newState.id === client.user?.id) {
    if (newState.channelId !== VOICE_CHANNEL_ID) schedule(2000);
  }
});
client.on("error", console.error);

function shutdown() {
  shuttingDown = true;
  if (timer) clearTimeout(timer);
  getVoiceConnection(GUILD_ID)?.destroy();
  client.destroy();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
client.login(DISCORD_TOKEN).catch((error) => {
  console.error("Login failed:", error);
  process.exit(1);
});
