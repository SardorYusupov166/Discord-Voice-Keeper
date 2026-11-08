import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { commands, handleInteraction } from "./commands.js";
import { VoiceKeeper } from "./keeper.js";
import { migrateLegacyConfig } from "./storage.js";

if (!process.env.DISCORD_TOKEN) {
  console.error("CONFIG_ERROR: Set DISCORD_TOKEN in .env");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const log = (event, details = "") => console.log(`${new Date().toISOString()} ${event} ${details}`.trim());
const keeper = new VoiceKeeper(client, { log });
let stopping = false;
let registrationTimer;

async function registerCommands() {
  if (stopping || !client.isReady()) return;
  try {
    await client.application.commands.set(commands);
    log("COMMANDS_REGISTERED", `count=${commands.length}`);
  } catch (error) {
    console.error("COMMANDS_REGISTER_FAILED:", error);
    registrationTimer = setTimeout(() => { void registerCommands(); }, 60_000);
  }
}

client.once("ready", () => {
  log("GATEWAY_READY", `user=${client.user.tag}`);
  if (migrateLegacyConfig(process.env.GUILD_ID, process.env.VOICE_CHANNEL_ID)) log("LEGACY_CONFIG_MIGRATED");
  keeper.start();
  void registerCommands();
});
client.on("shardResume", () => {
  log("GATEWAY_RESUMED");
  keeper.onGatewayResume();
  void registerCommands();
});
client.on("shardDisconnect", (event) => log("GATEWAY_DISCONNECTED", `code=${event.code}`));
client.on("voiceStateUpdate", (_oldState, newState) => keeper.onVoiceState(newState));
client.on("interactionCreate", (interaction) => {
  void handleInteraction(interaction, keeper).catch((error) => console.error("INTERACTION_ERROR:", error));
});
client.on("error", (error) => console.error("GATEWAY_ERROR:", error));
client.on("warn", (message) => log("GATEWAY_WARN", message));

function shutdown() {
  if (stopping) return;
  stopping = true;
  if (registrationTimer) clearTimeout(registrationTimer);
  keeper.stop();
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
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("LOGIN_FAILED:", error);
  process.exitCode = 1;
  shutdown();
});
