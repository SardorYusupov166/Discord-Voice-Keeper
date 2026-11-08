import { ChannelType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { getGuild, isAllowed } from "./storage.js";

const voiceOption = (option, required) => option.setName("channel").setDescription("Голосовой канал")
  .addChannelTypes(ChannelType.GuildVoice).setRequired(required);

export const commands = [
  new SlashCommandBuilder().setName("join").setDescription("Подключить бота к голосовому каналу")
    .addChannelOption((option) => voiceOption(option, false)),
  new SlashCommandBuilder().setName("leave").setDescription("Отключить бота и запретить автовозврат"),
  new SlashCommandBuilder().setName("move").setDescription("Переместить бота в другой голосовой канал")
    .addChannelOption((option) => voiceOption(option, true)),
  new SlashCommandBuilder().setName("status").setDescription("Показать состояние бота на этом сервере"),
  new SlashCommandBuilder().setName("reconnect").setDescription("Переподключить бота"),
  new SlashCommandBuilder().setName("setchannel").setDescription("Установить основной голосовой канал")
    .addChannelOption((option) => voiceOption(option, true)),
  new SlashCommandBuilder().setName("autojoin").setDescription("Управлять постоянным присутствием")
    .addSubcommand((sub) => sub.setName("enable").setDescription("Включить автоподключение"))
    .addSubcommand((sub) => sub.setName("disable").setDescription("Выключить автоподключение")),
].map((command) => command.toJSON());

export async function handleInteraction(interaction, keeper, { dir, error = console.error } = {}) {
  if (!interaction.isChatInputCommand()) return;
  const privateReply = { flags: MessageFlags.Ephemeral };
  try {
    // Read from disk on every command. Discord roles, ownership and permissions never bypass this check.
    if (!isAllowed(interaction.user.id, dir)) {
      await interaction.reply({ content: "Доступ запрещён. Обратитесь к владельцу бота.", ...privateReply });
      return;
    }
  } catch (cause) {
    error("ACCESS_CHECK_FAILED", cause);
    await interaction.reply({ content: "Проверка доступа временно недоступна.", ...privateReply });
    return;
  }
  if (!interaction.guildId) {
    await interaction.reply({ content: "Эта команда работает только на сервере Discord.", ...privateReply });
    return;
  }
  await interaction.deferReply(privateReply);
  const guildId = interaction.guildId;
  try {
    let message;
    switch (interaction.commandName) {
      case "join": {
        const channelId = interaction.options.getChannel("channel")?.id ?? interaction.member?.voice?.channelId ??
          getGuild(guildId, dir).channelId;
        if (!channelId) throw new Error("Выберите канал, зайдите в голосовой канал или задайте /setchannel.");
        const connected = await keeper.join(guildId, channelId);
        message = connected ? `Подключён к <#${channelId}>.` : `Подключение к <#${channelId}> не удалось; повторная попытка запланирована.`;
        break;
      }
      case "leave":
        keeper.leave(guildId);
        message = "Отключён. Автоподключение выключено, бот не вернётся сам.";
        break;
      case "move": {
        const channelId = interaction.options.getChannel("channel", true).id;
        const connected = await keeper.join(guildId, channelId);
        message = connected ? `Перемещён в <#${channelId}>.` : `Переход в <#${channelId}> не удался; повторная попытка запланирована.`;
        break;
      }
      case "status": {
        const state = keeper.status(guildId);
        message = `Соединение: ${state.connection}\nОсновной канал: ${state.channelId ? `<#${state.channelId}>` : "не задан"}` +
          `\nЦелевой канал: ${state.targetChannelId ? `<#${state.targetChannelId}>` : "нет"}` +
          `\nАвтоподключение: ${state.autojoin ? "включено" : "выключено"}` +
          `\nПоддержание соединения: ${state.active ? "включено" : "выключено"}` +
          `\nСледующая задержка при сбое: ${state.retryMs} мс`;
        break;
      }
      case "reconnect": {
        const connected = await keeper.reconnect(guildId);
        message = connected ? "Переподключён." : "Не удалось переподключиться; повторная попытка запланирована.";
        break;
      }
      case "setchannel": {
        const channelId = interaction.options.getChannel("channel", true).id;
        keeper.setChannel(guildId, channelId);
        message = `Основной канал: <#${channelId}>.`;
        break;
      }
      case "autojoin": {
        const enabled = interaction.options.getSubcommand() === "enable";
        keeper.setAutojoin(guildId, enabled);
        message = enabled ? "Автоподключение включено." : "Автоподключение выключено. Текущее соединение остаётся до отключения.";
        break;
      }
      default:
        message = "Неизвестная команда.";
    }
    await interaction.editReply({ content: message });
  } catch (cause) {
    error(`COMMAND_FAILED guild=${guildId} command=${interaction.commandName}`, cause);
    await interaction.editReply({ content: `Ошибка: ${cause.message}` });
  }
}
