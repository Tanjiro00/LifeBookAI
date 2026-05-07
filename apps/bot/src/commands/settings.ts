import type { Context } from "grammy";
import { ensureTelegramUser } from "../services/userService.js";
import { reminderPresetKeyboard } from "../keyboards/onboarding.js";
import { isProActive } from "../services/subscriptions.js";

const DAY_LABELS: Record<number, string> = {
  1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 7: "Вс"
};

export async function sendSettings(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);

  const reminderLine =
    user.reminderFrequency === "MANUAL"
      ? "только когда я сам(а) пишу"
      : `${user.reminderFrequency === "MONTHLY" ? "раз в 2 недели" : "раз в неделю"}${
          user.reminderDay ? `, ${DAY_LABELS[user.reminderDay]}` : ""
        }${user.reminderTime ? ` в ${user.reminderTime}` : ""}`;

  const proLine = isProActive(user)
    ? user.proUntil
      ? `Pro до ${user.proUntil.toLocaleDateString("ru-RU")}`
      : "Pro активен"
    : "Бесплатный план";

  await ctx.reply(
    [
      "Настройки",
      "",
      `Напоминания: ${reminderLine}`,
      `Часовой пояс: ${user.timezone || "Europe/Moscow"}`,
      `План: ${proLine}`,
      "",
      "Поменять напоминания:"
    ].join("\n"),
    { reply_markup: reminderPresetKeyboard() }
  );
}
