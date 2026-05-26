import { Bot } from "grammy";
import { ReminderFrequency, UserState, type User } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { weeklyPromptKeyboard } from "../keyboards/mainMenu.js";
import { logger } from "../lib/logger.js";
import { track } from "./analytics.js";
import { catchupText, pickReminderText, shouldSendCatchup } from "./engagement.js";
import { detectContentLanguage } from "@lifebook/ai";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DEDUPE_WINDOW_MS = 8 * 60 * 60 * 1000;

function localSlotForUser(user: User, now: Date): { day: number; time: string; weekIndex: number } {
  const tz = user.timezone || "Europe/Moscow";
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = fmt.formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value || "";

  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const day = weekdayMap[part("weekday")] || 1;
  const time = `${part("hour")}:${part("minute")}`;
  const weekIndex = Math.floor(Math.floor(now.getTime() / ONE_DAY_MS) / 7);
  return { day, time, weekIndex };
}

function languageFor(user: User): "ru" | "en" {
  return detectContentLanguage("", user.languageCode);
}

export function startReminderLoop(bot: Bot): NodeJS.Timeout {
  return setInterval(() => {
    void Promise.all([sendDueReminders(bot), sendDueCatchups(bot)]).catch((error) =>
      logger.error({ err: error }, "Reminder loop failed")
    );
  }, 60_000);
}

export async function sendDueReminders(bot: Bot, now = new Date()): Promise<number> {
  const candidates = await prisma.user.findMany({
    where: {
      onboardingDone: true,
      reminderFrequency: { in: [ReminderFrequency.WEEKLY, ReminderFrequency.MONTHLY] }
    },
    take: 1000
  });

  let sent = 0;
  for (const user of candidates) {
    if (!user.reminderTime) continue;
    const slot = localSlotForUser(user, now);

    if (user.reminderFrequency === ReminderFrequency.WEEKLY) {
      if (user.reminderDay !== slot.day) continue;
    } else if (user.reminderFrequency === ReminderFrequency.MONTHLY) {
      const tz = user.timezone || "Europe/Moscow";
      const dayOfMonth = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit" }).format(now));
      const monthlyDay = user.reminderDay || dayOfMonth;
      if (dayOfMonth !== monthlyDay) continue;
    }

    if (slot.time !== user.reminderTime) continue;
    if (user.lastReminderAt && now.getTime() - user.lastReminderAt.getTime() < REMINDER_DEDUPE_WINDOW_MS) continue;

    try {
      const language = languageFor(user);
      const lastEntry = await prisma.page.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { sceneTitle: true }
      });
      const text = pickReminderText({
        language,
        lastTitle: lastEntry?.sceneTitle ?? null,
        weekIndex: slot.weekIndex
      });
      await bot.api.sendMessage(String(user.telegramId), text, { reply_markup: weeklyPromptKeyboard({ languageCode: user.languageCode }) });
      await prisma.user.update({
        where: { id: user.id },
        data: { state: UserState.WAITING_FOR_WEEKLY_INPUT, lastReminderAt: now }
      });
      track("reminder_sent", { userId: user.id, frequency: user.reminderFrequency });
      sent += 1;
    } catch (error) {
      logger.warn({ err: error, userId: user.id }, "Failed to send reminder");
    }
  }
  return sent;
}

export async function sendDueCatchups(bot: Bot, now = new Date()): Promise<number> {
  const cutoffWeek = new Date(now.getTime() - 9 * ONE_DAY_MS);
  const candidates = await prisma.user.findMany({
    where: {
      onboardingDone: true,
      OR: [{ lastCatchupAt: null }, { lastCatchupAt: { lt: cutoffWeek } }]
    },
    take: 500
  });

  let sent = 0;
  for (const user of candidates) {
    const lastEntry = await prisma.page.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, sceneTitle: true }
    });
    const reference = lastEntry?.createdAt || user.createdAt;
    const days = Math.floor((now.getTime() - reference.getTime()) / ONE_DAY_MS);

    if (!shouldSendCatchup({ daysSinceLastEntry: days, lastCatchupAt: user.lastCatchupAt })) continue;

    try {
      const language = languageFor(user);
      const text = catchupText(language, lastEntry?.sceneTitle);
      await bot.api.sendMessage(String(user.telegramId), text, { reply_markup: weeklyPromptKeyboard({ languageCode: user.languageCode }) });
      await prisma.user.update({
        where: { id: user.id },
        data: { lastCatchupAt: now }
      });
      track("reminder_sent", { userId: user.id, kind: "catchup", days });
      sent += 1;
    } catch (error) {
      logger.warn({ err: error, userId: user.id }, "Failed to send catchup");
    }
  }
  return sent;
}
