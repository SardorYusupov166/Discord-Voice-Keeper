import { ChannelType } from "discord.js";
import { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus } from "@discordjs/voice";
import { getGuild, readGuilds, setGuild } from "./storage.js";

const defaultVoice = { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus };
const WATCHDOG_MS = 60_000;
const READY_TIMEOUT_MS = 25_000;

export class VoiceKeeper {
  constructor(client, { dir, voice = defaultVoice, log = console.log, error = console.error } = {}) {
    this.client = client;
    this.dir = dir;
    this.voice = voice;
    this.log = log;
    this.error = error;
    this.guilds = new Map();
    this.stopping = false;
  }

  state(guildId) {
    if (!this.guilds.has(guildId)) {
      this.guilds.set(guildId, { active: false, targetChannelId: null, generation: 0, timer: null, checking: null,
        connection: null, retryMs: getGuild(guildId, this.dir).reconnect.baseDelayMs });
    }
    return this.guilds.get(guildId);
  }

  start() {
    for (const [guildId, settings] of Object.entries(readGuilds(this.dir))) {
      if (settings.autojoin && settings.channelId) {
        const state = this.state(guildId);
        state.active = true;
        state.targetChannelId = settings.channelId;
        this.schedule(guildId, 0);
      }
    }
  }

  schedule(guildId, delay) {
    const state = this.state(guildId);
    if (this.stopping || !state.active) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.ensure(guildId);
    }, delay);
  }

  destroy(guildId) {
    const state = this.state(guildId);
    const connection = this.voice.getVoiceConnection(guildId);
    if (connection && connection.state.status !== this.voice.VoiceConnectionStatus.Destroyed) connection.destroy();
    state.connection = null;
  }

  attach(guildId, connection) {
    const state = this.state(guildId);
    if (state.connection === connection) return;
    state.connection = connection;
    connection.on("error", (error) => {
      if (state.connection !== connection || this.stopping) return;
      this.error(`VOICE_ERROR guild=${guildId}`, error);
      this.destroy(guildId);
      this.schedule(guildId, state.retryMs);
    });
    connection.on("stateChange", (before, after) => {
      if (state.connection !== connection || this.stopping) return;
      this.log(`VOICE_STATE guild=${guildId} ${before.status} -> ${after.status}`);
      if (after.status === this.voice.VoiceConnectionStatus.Ready) {
        state.retryMs = getGuild(guildId, this.dir).reconnect.baseDelayMs;
        this.log(`VOICE_READY guild=${guildId} channel=${state.targetChannelId}`);
        this.schedule(guildId, WATCHDOG_MS);
      } else if (after.status === this.voice.VoiceConnectionStatus.Disconnected ||
                 after.status === this.voice.VoiceConnectionStatus.Destroyed) {
        this.schedule(guildId, 2_000);
      }
    });
  }

  async ensure(guildId) {
    const state = this.state(guildId);
    if (!state.active || this.stopping) return false;
    if (state.checking) return state.checking;
    const generation = state.generation;
    state.checking = this.connect(guildId);
    try { return await state.checking; } finally {
      state.checking = null;
      if (state.active && state.generation !== generation) this.schedule(guildId, 0);
    }
  }

  async connect(guildId) {
    const state = this.state(guildId);
    const generation = state.generation;
    if (!this.client.isReady()) {
      this.schedule(guildId, 10_000);
      return false;
    }
    try {
      const guild = this.client.guilds.cache.get(guildId) ?? await this.client.guilds.fetch(guildId);
      const channelId = state.targetChannelId;
      const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId);
      if (state.generation !== generation || !state.active) return false;
      if (!channel || channel.guildId !== guildId || channel.type !== ChannelType.GuildVoice) {
        throw new Error("Target is not a standard voice channel in this guild");
      }
      const voiceState = guild.voiceStates.cache.get(this.client.user.id);
      const mismatch = voiceState && (voiceState.channelId !== channelId || !voiceState.selfMute || !voiceState.selfDeaf);
      let connection = this.voice.getVoiceConnection(guildId);
      if (connection && (connection.state.status === this.voice.VoiceConnectionStatus.Destroyed ||
          connection.joinConfig.channelId !== channelId)) {
        this.destroy(guildId);
        connection = null;
      }
      if (connection?.state.status === this.voice.VoiceConnectionStatus.Ready && !mismatch) {
        this.schedule(guildId, WATCHDOG_MS);
        return true;
      }
      if (connection && (connection.state.status === this.voice.VoiceConnectionStatus.Disconnected || mismatch)) {
        this.log(`VOICE_REJOIN guild=${guildId} channel=${channelId}`);
        if (!connection.rejoin({ channelId, selfMute: true, selfDeaf: true })) {
          this.destroy(guildId);
          connection = null;
        }
      }
      if (!connection) {
        this.log(`VOICE_JOIN guild=${guildId} channel=${channelId}`);
        connection = this.voice.joinVoiceChannel({ guildId, channelId, adapterCreator: guild.voiceAdapterCreator,
          selfMute: true, selfDeaf: true });
      }
      this.attach(guildId, connection);
      await this.voice.entersState(connection, this.voice.VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
      if (state.generation !== generation || !state.active) return false;
      state.retryMs = getGuild(guildId, this.dir).reconnect.baseDelayMs;
      this.schedule(guildId, WATCHDOG_MS);
      return true;
    } catch (error) {
      if (state.generation !== generation || !state.active) return false;
      this.error(`VOICE_CONNECT_FAILED guild=${guildId}`, error);
      this.destroy(guildId);
      const limit = getGuild(guildId, this.dir).reconnect.maxDelayMs;
      const delay = state.retryMs;
      state.retryMs = Math.min(Math.round(delay * 1.7), limit);
      this.log(`VOICE_RETRY guild=${guildId} in=${delay}ms`);
      this.schedule(guildId, delay);
      return false;
    }
  }

  async join(guildId, channelId) {
    const state = this.state(guildId);
    state.generation++;
    state.active = true;
    state.targetChannelId = channelId;
    if (state.connection?.joinConfig.channelId !== channelId) this.destroy(guildId);
    return this.ensure(guildId);
  }

  leave(guildId) {
    setGuild(guildId, { autojoin: false }, this.dir);
    const state = this.state(guildId);
    state.generation++;
    state.active = false;
    state.targetChannelId = null;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    this.destroy(guildId);
    this.log(`VOICE_LEAVE guild=${guildId}`);
  }

  setChannel(guildId, channelId) {
    const settings = setGuild(guildId, { channelId }, this.dir);
    const state = this.state(guildId);
    if (settings.autojoin) {
      state.generation++;
      state.active = true;
      state.targetChannelId = channelId;
      this.destroy(guildId);
      this.schedule(guildId, 0);
    }
    return settings;
  }

  setAutojoin(guildId, enabled) {
    const settings = getGuild(guildId, this.dir);
    if (enabled && !settings.channelId) throw new Error("Set the main channel with /setchannel first");
    setGuild(guildId, { autojoin: enabled }, this.dir);
    const state = this.state(guildId);
    if (enabled) {
      state.generation++;
      state.active = true;
      state.targetChannelId = settings.channelId;
      this.schedule(guildId, 0);
    } else {
      state.generation++;
      state.active = false;
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
    }
  }

  async reconnect(guildId) {
    const state = this.state(guildId);
    const channelId = state.targetChannelId ?? getGuild(guildId, this.dir).channelId;
    if (!channelId) throw new Error("Set the main channel with /setchannel first");
    this.destroy(guildId);
    return this.join(guildId, channelId);
  }

  status(guildId) {
    const settings = getGuild(guildId, this.dir);
    const state = this.state(guildId);
    const connection = this.voice.getVoiceConnection(guildId);
    return { ...settings, active: state.active, targetChannelId: state.targetChannelId,
      connection: connection?.state.status ?? "none", retryMs: state.retryMs };
  }

  onVoiceState(newState) {
    if (newState.id !== this.client.user?.id) return;
    const state = this.guilds.get(newState.guild.id);
    if (state?.active && (newState.channelId !== state.targetChannelId || !newState.selfMute || !newState.selfDeaf)) {
      this.log(`VOICE_MISMATCH guild=${newState.guild.id} channel=${newState.channelId ?? "none"}`);
      this.schedule(newState.guild.id, 2_000);
    }
  }

  onGatewayResume() {
    for (const [guildId, state] of this.guilds) if (state.active) this.schedule(guildId, 0);
  }

  stop() {
    this.stopping = true;
    for (const [guildId, state] of this.guilds) {
      if (state.timer) clearTimeout(state.timer);
      this.destroy(guildId);
    }
  }
}
