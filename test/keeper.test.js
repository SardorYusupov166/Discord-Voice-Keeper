import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { ChannelType, MessageFlags } from "discord.js";
import { commands, handleInteraction } from "../src/commands.js";
import { VoiceKeeper } from "../src/keeper.js";
import { changeWhitelist, getGuild, isAllowed, migrateLegacyConfig, readWhitelist, setGuild } from "../src/storage.js";

const USER = "123456789012345678";
const OUTSIDER = "223456789012345678";
const GUILD_A = "323456789012345678";
const GUILD_B = "423456789012345678";
const CHANNEL_A = "523456789012345678";
const CHANNEL_B = "623456789012345678";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-keeper-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function mockInteraction(userId, commandName, guildId = GUILD_A, admin = false) {
  const calls = [];
  return {
    user: { id: userId }, guildId, commandName, memberPermissions: admin ? { has: () => true } : { has: () => false },
    options: { getChannel: () => null, getSubcommand: () => "enable" },
    isChatInputCommand: () => true,
    reply: async (value) => { calls.push(["reply", value]); },
    deferReply: async (value) => { calls.push(["defer", value]); },
    editReply: async (value) => { calls.push(["edit", value]); },
    calls,
  };
}

function mockVoice() {
  const connections = new Map();
  const statuses = { Ready: "ready", Destroyed: "destroyed", Disconnected: "disconnected" };
  return {
    connections,
    VoiceConnectionStatus: statuses,
    getVoiceConnection: (guildId) => connections.get(guildId),
    joinVoiceChannel: (options) => {
      const connection = new EventEmitter();
      connection.state = { status: statuses.Ready };
      connection.joinConfig = options;
      connection.destroy = () => { connection.state = { status: statuses.Destroyed }; connections.delete(options.guildId); };
      connection.rejoin = () => true;
      connections.set(options.guildId, connection);
      return connection;
    },
    entersState: async (connection) => connection,
  };
}

function mockClient() {
  const guild = (id, channelId) => ({
    id, voiceAdapterCreator: {}, voiceStates: { cache: new Map() },
    channels: { cache: new Map([[channelId, { id: channelId, guildId: id, type: ChannelType.GuildVoice }]]) },
  });
  return { isReady: () => true, user: { id: USER },
    guilds: { cache: new Map([[GUILD_A, guild(GUILD_A, CHANNEL_A)], [GUILD_B, guild(GUILD_B, CHANNEL_B)]]) } };
}

test("whitelist defaults to empty and accepts only valid IDs", (t) => {
  const dir = fixture(t);
  assert.deepEqual(readWhitelist(dir), []);
  assert.equal(isAllowed(USER, dir), false);
  assert.throws(() => changeWhitelist("add", "bad-id", dir));
  changeWhitelist("add", USER, dir);
  assert.equal(isAllowed(USER, dir), true);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(dir, "whitelist.json")).mode & 0o777, 0o600);
  }
  changeWhitelist("remove", USER, dir);
  assert.equal(isAllowed(USER, dir), false);
});

test("authorization is checked on every command and ignores server admin status", async (t) => {
  const dir = fixture(t);
  const keeper = { status: () => ({ connection: "none", channelId: null, targetChannelId: null,
    autojoin: false, active: false, retryMs: 5000 }) };
  const denied = mockInteraction(USER, "status");
  await handleInteraction(denied, keeper, { dir });
  assert.equal(denied.calls[0][0], "reply");
  assert.equal(denied.calls[0][1].flags, MessageFlags.Ephemeral);
  changeWhitelist("add", USER, dir);
  const allowed = mockInteraction(USER, "status");
  await handleInteraction(allowed, keeper, { dir });
  assert.deepEqual(allowed.calls.map(([kind]) => kind), ["defer", "edit"]);
  assert.equal(allowed.calls[0][1].flags, MessageFlags.Ephemeral);
  const adminOutsideList = mockInteraction(OUTSIDER, "status", GUILD_B, true);
  await handleInteraction(adminOutsideList, keeper, { dir });
  assert.equal(adminOutsideList.calls[0][0], "reply");
  changeWhitelist("remove", USER, dir);
  const deniedAgain = mockInteraction(USER, "status");
  await handleInteraction(deniedAgain, keeper, { dir });
  assert.equal(deniedAgain.calls[0][0], "reply");
});

test("guild settings are isolated and only enabled autojoins restore", (t) => {
  const dir = fixture(t);
  setGuild(GUILD_A, { channelId: CHANNEL_A, autojoin: true }, dir);
  setGuild(GUILD_B, { channelId: CHANNEL_B, autojoin: false }, dir);
  assert.equal(getGuild(GUILD_B, dir).channelId, CHANNEL_B);
  const keeper = new VoiceKeeper(mockClient(), { dir, voice: mockVoice(), log: () => {}, error: () => {} });
  keeper.start();
  assert.equal(keeper.state(GUILD_A).active, true);
  assert.equal(keeper.state(GUILD_A).targetChannelId, CHANNEL_A);
  assert.equal(keeper.state(GUILD_B).active, false);
  keeper.stop();
});

test("legacy single-guild .env configuration migrates once", (t) => {
  const dir = fixture(t);
  assert.equal(migrateLegacyConfig(GUILD_A, CHANNEL_A, dir), true);
  assert.equal(getGuild(GUILD_A, dir).autojoin, true);
  assert.equal(getGuild(GUILD_A, dir).channelId, CHANNEL_A);
  assert.equal(migrateLegacyConfig(GUILD_B, CHANNEL_B, dir), false);
  assert.equal(getGuild(GUILD_B, dir).channelId, null);
});

test("connections are independent and leave prevents automatic return", async (t) => {
  const dir = fixture(t);
  setGuild(GUILD_A, { channelId: CHANNEL_A, autojoin: true }, dir);
  setGuild(GUILD_B, { channelId: CHANNEL_B, autojoin: true }, dir);
  const voice = mockVoice();
  const keeper = new VoiceKeeper(mockClient(), { dir, voice, log: () => {}, error: () => {} });
  assert.equal(await keeper.join(GUILD_A, CHANNEL_A), true);
  assert.equal(await keeper.join(GUILD_B, CHANNEL_B), true);
  assert.equal(await keeper.join(GUILD_B, CHANNEL_B), true);
  assert.equal(voice.connections.size, 2);
  keeper.leave(GUILD_A);
  assert.equal(getGuild(GUILD_A, dir).autojoin, false);
  assert.equal(keeper.state(GUILD_A).active, false);
  assert.equal(voice.connections.has(GUILD_A), false);
  assert.equal(voice.connections.has(GUILD_B), true);
  keeper.onVoiceState({ id: USER, guild: { id: GUILD_A }, channelId: null });
  assert.equal(keeper.state(GUILD_A).timer, null);
  keeper.stop();
  const restarted = new VoiceKeeper(mockClient(), { dir, voice: mockVoice(), log: () => {} });
  restarted.start();
  assert.equal(restarted.state(GUILD_A).active, false);
  assert.equal(restarted.state(GUILD_B).active, true);
  restarted.stop();
});

test("failed connection backs off only for its own guild", async (t) => {
  const dir = fixture(t);
  const voice = mockVoice();
  voice.entersState = async () => { throw new Error("voice timeout"); };
  const keeper = new VoiceKeeper(mockClient(), { dir, voice, log: () => {}, error: () => {} });
  assert.equal(await keeper.join(GUILD_A, CHANNEL_A), false);
  assert.equal(keeper.state(GUILD_A).retryMs, 8_500);
  assert.equal(keeper.state(GUILD_B).retryMs, 5_000);
  assert.equal(voice.connections.size, 0);
  keeper.stop();
});

test("registered commands contain no whitelist management", () => {
  assert.deepEqual(commands.map((command) => command.name),
    ["join", "leave", "move", "status", "reconnect", "setchannel", "autojoin"]);
  assert.deepEqual(commands.find((command) => command.name === "autojoin").options.map((option) => option.name),
    ["enable", "disable"]);
});
