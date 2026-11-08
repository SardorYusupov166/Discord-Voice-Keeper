import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const isSnowflake = (value) => typeof value === "string" && /^\d{17,20}$/.test(value);
export const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), "data");
export const defaultReconnect = Object.freeze({ baseDelayMs: 5_000, maxDelayMs: 60_000 });

function prepare(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJson(file, value) {
  const dir = path.dirname(file);
  prepare(dir);
  const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function withLock(dir, name, callback) {
  prepare(dir);
  const lock = path.join(dir, `.${name}.lock`);
  let fd;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      fd = fs.openSync(lock, "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; }
      catch (statError) { if (statError.code === "ENOENT") continue; throw statError; }
      if (age > 30_000) { fs.unlinkSync(lock); continue; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  if (fd === undefined) throw new Error(`Timed out waiting for ${name} lock`);
  try {
    return callback();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

export function readWhitelist(dir = dataDir()) {
  const value = readJson(path.join(dir, "whitelist.json"), { version: 1, users: [] });
  if (value.version !== 1 || !Array.isArray(value.users) || !value.users.every(isSnowflake)) {
    throw new Error("Invalid whitelist.json");
  }
  return [...new Set(value.users)];
}

export function isAllowed(userId, dir = dataDir()) {
  return isSnowflake(userId) && readWhitelist(dir).includes(userId);
}

export function changeWhitelist(action, userId, dir = dataDir()) {
  if (!isSnowflake(userId)) throw new Error("Discord User ID must contain 17–20 digits");
  if (!new Set(["add", "remove"]).has(action)) throw new Error("Invalid whitelist action");
  return withLock(dir, "whitelist", () => {
    const users = new Set(readWhitelist(dir));
    if (action === "add") users.add(userId);
    else users.delete(userId);
    writeJson(path.join(dir, "whitelist.json"), { version: 1, users: [...users].sort() });
    return [...users].sort();
  });
}

export function readGuilds(dir = dataDir()) {
  const value = readJson(path.join(dir, "guilds.json"), { version: 1, guilds: {} });
  if (value.version !== 1 || !value.guilds || typeof value.guilds !== "object" || Array.isArray(value.guilds)) {
    throw new Error("Invalid guilds.json");
  }
  for (const [guildId, settings] of Object.entries(value.guilds)) {
    if (!isSnowflake(guildId) || !settings || typeof settings !== "object" ||
        (settings.channelId !== null && !isSnowflake(settings.channelId)) || typeof settings.autojoin !== "boolean" ||
        (settings.reconnect && (!Number.isInteger(settings.reconnect.baseDelayMs) ||
          !Number.isInteger(settings.reconnect.maxDelayMs) || settings.reconnect.baseDelayMs < 1_000 ||
          settings.reconnect.maxDelayMs < settings.reconnect.baseDelayMs || settings.reconnect.maxDelayMs > 300_000))) {
      throw new Error(`Invalid settings for guild ${guildId}`);
    }
  }
  return value.guilds;
}

export function getGuild(guildId, dir = dataDir()) {
  if (!isSnowflake(guildId)) throw new Error("Invalid guild ID");
  return { channelId: null, autojoin: false, reconnect: { ...defaultReconnect }, ...readGuilds(dir)[guildId] };
}

export function setGuild(guildId, patch, dir = dataDir()) {
  if (!isSnowflake(guildId)) throw new Error("Invalid guild ID");
  return withLock(dir, "guilds", () => {
    const guilds = readGuilds(dir);
    const next = { ...getGuild(guildId, dir), ...patch };
    if ((next.channelId !== null && !isSnowflake(next.channelId)) || typeof next.autojoin !== "boolean" ||
        !Number.isInteger(next.reconnect?.baseDelayMs) || !Number.isInteger(next.reconnect?.maxDelayMs) ||
        next.reconnect.baseDelayMs < 1_000 || next.reconnect.maxDelayMs < next.reconnect.baseDelayMs ||
        next.reconnect.maxDelayMs > 300_000) {
      throw new Error("Invalid guild settings");
    }
    guilds[guildId] = next;
    writeJson(path.join(dir, "guilds.json"), { version: 1, guilds });
    return next;
  });
}

export function migrateLegacyConfig(guildId, channelId, dir = dataDir()) {
  if (!isSnowflake(guildId) || !isSnowflake(channelId)) return false;
  if (fs.existsSync(path.join(dir, "guilds.json"))) return false;
  setGuild(guildId, { channelId, autojoin: true }, dir);
  return true;
}
