import type { Context } from "grammy";
import { ensureTelegramUser } from "../services/userService.js";
import { settingsKeyboard } from "../keyboards/settings.js";

export async function sendSettings(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  await ctx.reply(
    [
      "Настройки книги",
      "",
      `Цель: ${user.writingGoal || "ещё не выбрана"}`,
      `Стиль: ${user.writingStyle || "ещё не выбран"}`,
      `Напоминания: ${user.reminderFrequency}${user.reminderDay ? `, день ${user.reminderDay}` : ""}${user.reminderTime ? ` в ${user.reminderTime}` : ""}`
    ].join("\n"),
    { reply_markup: settingsKeyboard() }
  );
}

