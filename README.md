# Discord Voice Keeper

Бот постоянно находится в одном голосовом канале без передачи или воспроизведения звука. При подключении используются `selfMute: true` и `selfDeaf: true`. После потери связи бот переподключается, а после перезагрузки Ubuntu его запускает systemd.

## Подготовка Discord

1. Создайте бота в [Discord Developer Portal](https://discord.com/developers/applications) и пригласите его на сервер с правами **View Channel** и **Connect** для выбранного голосового канала. Для переподключения канал не должен быть заполнен или иметь ограничение, блокирующее бота.
2. Включите Developer Mode в Discord и скопируйте ID сервера и обычного голосового канала. Stage channels не поддерживаются.
3. Сохраните токен бота. Не вставляйте его в GitHub, чат или команды, которые попадут в историю оболочки.

Привилегированные gateway intents не требуются.

## Установка на Oracle Cloud Ubuntu 22.04

На Windows в PowerShell подключитесь с вашим **локальным** приватным ключом (замените путь):

```powershell
ssh -i "C:\path\to\your\private-key.key" ubuntu@132.145.102.65
```

На сервере выполните:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/SardorYusupov166/Discord-Voice-Keeper.git
cd Discord-Voice-Keeper
sudo bash deploy/install.sh
sudo nano /opt/discord-voice-keeper/.env
sudo systemctl start discord-voice-keeper.service
sudo journalctl -u discord-voice-keeper.service -n 50 --no-pager
```

В `.env` заполните ровно три значения:

```dotenv
DISCORD_TOKEN=your_bot_token
GUILD_ID=123456789012345678
VOICE_CHANNEL_ID=123456789012345678
```

Файл `.env` находится только на сервере, принадлежит пользователю `ubuntu` и доступен только ему и root. Если токен содержит специальные символы для dotenv, заключите значение в двойные кавычки. После успешного запуска в журнале появится `VOICE_READY`. При ошибке подключения бот пишет `VOICE_CONNECT_FAILED` и повторяет попытки. Дополнительные входящие порты для бота не нужны.

## Обновление

```bash
sudo bash /opt/discord-voice-keeper/current/deploy/update.sh
```

Скрипт берёт `main` из этого же репозитория, устанавливает зависимости из `package-lock.json` в отдельный каталог, переключает символическую ссылку и перезапускает службу. Если `VOICE_READY` не появился за 45 секунд, скрипт возвращает предыдущую версию. `.env` остаётся на месте. Скрипт можно запускать повторно.

## Проверка и диагностика

```bash
systemctl status discord-voice-keeper.service --no-pager
sudo journalctl -u discord-voice-keeper.service -f
node --version
```

Требуется Node.js 22.13 или новее в ветке 22; установщик ставит его через NodeSource при необходимости. Установка включает автозапуск systemd. Соединения с Discord исходящие. Доступность бота также зависит от работы Discord, сети и самой виртуальной машины Oracle.

Локальная проверка после `npm ci`: `npm run check`. Для реальной проверки голосового подключения нужны действительные токен, ID и приглашённый в канал бот.
