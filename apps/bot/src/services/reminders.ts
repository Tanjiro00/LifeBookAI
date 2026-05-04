import { Bot } from "grammy";
import { ReminderFrequency, UserState } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { weeklyPromptKeyboard } from "../keyboards/mainMenu.js";
import { logger } from "../lib/logger.js";
import { track } from "./analytics.js";

function currentReminderSlot(now = new Date()): { day: number; time: string } {
  const jsDay = now.getDay();
  const day = jsDay === 0 ? 7 : jsDay;
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return { day, time: `${hh}:${mm}` };
}

export function startReminderLoop(bot: Bot): NodeJS.Timeout {
  return setInterval(() => {
    void sendDueReminders(bot).catch((error) => logger.error({ err: error }, "Reminder loop failed"));
  }, 60_000);
}

export async function sendDueReminders(bot: Bot, now = new Date()): Promise<number> {
  const { day, time } = currentReminderSlot(now);
  const users = await prisma.user.findMany({
    where: {
      onboardingDone: true,
      reminderFrequency: ReminderFrequency.WEEKLY,
      reminderDay: day,
      reminderTime: time
    },
    take: 100
  });

  for (const user of users) {
    await bot.api.sendMessage(
      Number(user.telegramId),
      [
        "Время новой главы.",
        "",
        "Что произошло на этой неделе? Можешь написать текстом или просто отправить голосовое.",
        "",
        "Не нужно красиво. Расскажи как есть — я помогу превратить это в историю."
      ].join("\n"),
      { reply_markup: weeklyPromptKeyboard() }
    );
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.WAITING_FOR_WEEKLY_INPUT } });
    track("reminder_sent", { userId: user.id });
  }

  return users.length;
}

