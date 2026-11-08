# Discord Voice Keeper

Один бот для нескольких Discord-серверов. Он находится в голосовых каналах без передачи звука (`selfMute` и `selfDeaf`), восстанавливает соединения и управляется приватными slash-командами. **Доступ к командам даёт только глобальный белый список Discord User ID.** Администраторы и владельцы серверов не получают доступ автоматически. Команд Discord для изменения белого списка нет.

## Подготовка Discord

1. Создайте бота в [Discord Developer Portal](https://discord.com/developers/applications) и пригласите его на нужные серверы с правами **View Channel** и **Connect** для голосовых каналов. В ссылке приглашения нужны scopes `bot` и `applications.commands`.
2. Сохраните токен бота. Привилегированные gateway intents не нужны.
3. В Discord включите Developer Mode, чтобы скопировать User ID для белого списка. Используйте обычные голосовые каналы, не Stage channels.

## Oracle Cloud: установка и обновление

На Windows подключитесь к серверу с локальным приватным ключом:

```powershell
ssh -i "C:\path\to\private-key.key" ubuntu@132.145.102.65
```

Первоначальная установка на Ubuntu 22.04:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/SardorYusupov166/Discord-Voice-Keeper.git
sudo bash Discord-Voice-Keeper/deploy/install.sh
sudo nano /opt/discord-voice-keeper/.env
sudo systemctl start discord-voice-keeper.service
sudo journalctl -u discord-voice-keeper.service -n 50 --no-pager
```

В `.env` обязателен только `DISCORD_TOKEN`. Установщик сохраняет существующий `.env`. Старые `GUILD_ID` и `VOICE_CHANNEL_ID` можно оставить: при первом запуске они однократно переносятся в настройки основного сервера с включённым автоподключением. На остальных серверах используйте `/setchannel` и `/autojoin enable`.

Проверка доступа через SSH (замените ID на свой Discord User ID):

```bash
cd /opt/discord-voice-keeper/current
npm run whitelist:add -- 123456789012345678
npm run whitelist:list
npm run whitelist:check -- 123456789012345678
npm run whitelist:remove -- 123456789012345678
```

Изменения белого списка применяются к следующей команде без перезапуска. По умолчанию список пуст. Файлы `/opt/discord-voice-keeper/data/whitelist.json` и `guilds.json` принадлежат `ubuntu`, доступны только ему и root, хранятся вне каталога версий. Доступ к консоли `ubuntu` следует ограничивать: владелец этой учётной записи может менять белый список. Секреты и файлы данных не отправляйте в GitHub.

## Команды Discord

Все ответы приватные. Каждая команда заново проверяет User ID в глобальном белом списке.

| Команда | Действие |
| --- | --- |
| `/join [channel]` | Подключиться к указанному каналу, текущему каналу пользователя или основному каналу. Соединение поддерживается до `/leave`, но после перезапуска восстанавливается только при включённом автоподключении. |
| `/leave` | Отключиться и выключить автоподключение на этом сервере. |
| `/move channel` | Временно перейти в другой канал. Основной канал не меняется. |
| `/status` | Показать настройки и состояние этого сервера. |
| `/reconnect` | Пересоздать соединение. |
| `/setchannel channel` | Сохранить основной канал; при включённом автоподключении бот перейдёт в него. |
| `/autojoin enable` | Включить постоянное присутствие в основном канале и восстановление после перезапуска. |
| `/autojoin disable` | Выключить поддержание соединения и восстановление после перезапуска; текущее соединение остаётся до отключения. |

Настройки серверов независимы. Повторные попытки используют отдельную экспоненциальную задержку для каждого сервера. Дополнительные входящие порты не нужны.

## Обновление и откат

```bash
sudo bash /opt/discord-voice-keeper/current/deploy/update.sh
sudo bash /opt/discord-voice-keeper/current/deploy/rollback.sh
```

Обновление скачивает `main` из этого репозитория, устанавливает зависимости из `package-lock.json` в отдельную версию, создаёт защищённую резервную копию `.env` и `data`, переключает версию и проверяет вход в Discord, регистрацию команд и настроенные автоподключения. Если новая версия не проходит проверку за 45 секунд, скрипт возвращает предыдущую. Архивы находятся в `/opt/discord-voice-keeper/backups` с правами root 600. Откат версии вручную выполняет `rollback.sh`; данные остаются на месте, резервная копия создаётся перед откатом.

Диагностика:

```bash
systemctl status discord-voice-keeper.service --no-pager
sudo journalctl -u discord-voice-keeper.service -f
node --version
```

Нужен Node.js 22.13 или новее в ветке 22. Для локальной проверки: `npm ci`, `npm run check`, `npm test`. Реальная регистрация команд и голосовое соединение требуют действительного токена и приглашённого на сервер бота.
