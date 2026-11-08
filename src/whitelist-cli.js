import "dotenv/config";
import { changeWhitelist, isAllowed, isSnowflake, readWhitelist } from "./storage.js";

const [action, userId, ...extra] = process.argv.slice(2);
try {
  if (extra.length || !new Set(["add", "remove", "list", "check"]).has(action)) {
    throw new Error("Usage: npm run whitelist:{add|remove|list|check} [-- USER_ID]");
  }
  if (action === "list") {
    if (userId) throw new Error("list does not take a User ID");
    const users = readWhitelist();
    console.log(users.length ? users.join("\n") : "Белый список пуст.");
  } else {
    if (!isSnowflake(userId)) throw new Error("Discord User ID must contain 17–20 digits");
    if (action === "check") {
      const allowed = isAllowed(userId);
      console.log(allowed ? "Доступ разрешён" : "Доступ запрещён");
      if (!allowed) process.exitCode = 1;
    } else {
      const users = changeWhitelist(action, userId);
      console.log(`${action === "add" ? "Добавлен" : "Удалён"}: ${userId}. Всего: ${users.length}`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
