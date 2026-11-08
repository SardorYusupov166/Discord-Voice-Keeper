import "dotenv/config";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus } from "@discordjs/voice";

const { DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID } = process.env;
if (!DISCORD_TOKEN || !/^\d{17,20}$/.test(GUILD_ID ?? "") || !/^\d{17,20}$/.test(VOICE_CHANNEL_ID ?? "")) {
  console.error("CONFIG_ERROR: Set DISCORD_TOKEN, GUILD_ID and VOICE_CHANNEL_ID in .env (IDs must be Discord snowflakes)");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let timer;
let checking = false;
let stopping = false;
let retryMs = 5_000;
let connection;
const WATCHDOG_MS = 60_000;
const READY_TIMEOUT_MS = 25_000;

function log(event, details = "") {
  console.log(`${new Date().toISOString()} ${event}${details ? ` ${details}` : ""}`);
}

function schedule(delay) {
  if (stopping) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void ensureConnection();
  }, delay);
}

function disposeConnection() {
  const existing = getVoiceConnection(GUILD_ID);
  if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) existing.destroy();
  connection = undefined;
}

function attachConnection(next) {
  if (connection === next) return;
  connection = next;
  next.on("error", (error) => {
    console.error("VOICE_ERROR:", error);
    schedule(2_000);
  });
  next.on("stateChange", (oldState, newState) => {
    log("VOICE_STATE", `${oldState.status} -> ${newState.status}`);
    if (newState.status === VoiceConnectionStatus.Ready) {
      retryMs = 5_000;
      log("VOICE_READY", `guild=${GUILD_ID} channel=${VOICE_CHANNEL_ID}`);
      schedule(WATCHDOG_MS);
    } else if (newState.status === VoiceConnectionStatus.Disconnected || newState.status === VoiceConnectionStatus.Destroyed) {
      schedule(2_000);
    }
  });
}

async function ensureConnection() {
  if (checking || stopping) return;
  if (!client.isReady()) {
    log("GATEWAY_WAIT", "Discord gateway is not ready");
    schedule(retryMs);
    return;
  }
  checking = true;
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(VOICE_CHANNEL_ID);
    if (!channel || channel.guildId !== GUILD_ID || channel.type !== ChannelType.GuildVoice) {
      throw new Error("Configured channel must be a standard voice channel in the configured guild");
    }

    const voiceState = guild.voiceStates.cache.get(client.user.id);
    const stateMismatch = voiceState && (voiceState.channelId !== VOICE_CHANNEL_ID || !voiceState.selfMute || !voiceState.selfDeaf);
    let next = getVoiceConnection(GUILD_ID);
    if (next && (next.state.status === VoiceConnectionStatus.Destroyed || next.joinConfig.channelId !== VOICE_CHANNEL_ID)) {
      disposeConnection();
      next = undefined;
    }
    if (next?.state.status === VoiceConnectionStatus.Ready && !stateMismatch) {
      schedule(WATCHDOG_MS);
      return;
    }
    if (next && (next.state.status === VoiceConnectionStatus.Disconnected || stateMismatch)) {
      log("VOICE_REJOIN", `status=${next.state.status} actualChannel=${voiceState?.channelId ?? "unknown"}`);
      if (!next.rejoin({ channelId: VOICE_CHANNEL_ID, selfDeaf: true, selfMute: true })) {
        disposeConnection();
        next = undefined;
      }
    }
    if (!next) {
      log("VOICE_JOIN", `guild=${GUILD_ID} channel=${VOICE_CHANNEL_ID}`);
      next = joinVoiceChannel({
        channelId: VOICE_CHANNEL_ID,
        guildId: GUILD_ID,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
      });
    }
    attachConnection(next);
    await entersState(next, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
    retryMs = 5_000;
    schedule(WATCHDOG_MS);
  } catch (error) {
    console.error("VOICE_CONNECT_FAILED:", error);
    // Signalling and connecting can remain stuck indefinitely after a timeout.
    disposeConnection();
    const delay = retryMs;
    retryMs = Math.min(Math.round(retryMs * 1.5), 60_000);
    log("VOICE_RETRY", `in=${delay}ms`);
    schedule(delay);
  } finally {
    checking = false;
  }
}

client.on("ready", () => {
  log("GATEWAY_READY", `user=${client.user.tag}`);
  schedule(0);
});
client.on("shardResume", () => {
  log("GATEWAY_RESUMED");
  schedule(0);
});
client.on("shardDisconnect", (event) => log("GATEWAY_DISCONNECTED", `code=${event.code}`));
client.on("voiceStateUpdate", (_oldState, newState) => {
  if (newState.id !== client.user?.id || newState.guild.id !== GUILD_ID) return;
  if (newState.channelId !== VOICE_CHANNEL_ID || !newState.selfMute || !newState.selfDeaf) {
    log("VOICE_STATE_MISMATCH", `channel=${newState.channelId ?? "none"} mute=${newState.selfMute} deaf=${newState.selfDeaf}`);
    schedule(2_000);
  }
});
client.on("error", (error) => console.error("GATEWAY_ERROR:", error));
client.on("warn", (message) => log("GATEWAY_WARN", message));

function shutdown() {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  disposeConnection();
  client.destroy();
  log("SHUTDOWN");
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED_REJECTION:", error);
  process.exitCode = 1;
  shutdown();
});
process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT_EXCEPTION:", error);
  process.exitCode = 1;
  shutdown();
});
client.login(DISCORD_TOKEN).catch((error) => {
  console.error("LOGIN_FAILED:", error);
  process.exitCode = 1;
  shutdown();
});
