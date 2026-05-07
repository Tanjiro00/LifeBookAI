import { ReminderFrequency, UserState } from "@prisma/client";
import type { Context } from "grammy";
import { ensureTelegramUser, markOnboardingReady } from "../services/userService.js";
import { prisma } from "../lib/db.js";
import { track } from "../services/analytics.js";

const DAY_NAMES_RU: Record<number, string> = {
  1: "в понедельник",
  2: "во вторник",
  3: "в среду",
  4: "в четверг",
  5: "в пятницу",
  6: "в субботу",
  7: "в воскресенье"
};

// One-step reminder picker. Called after the user has just received their first entry card.
// Encodes (frequency, day, time): "WEEKLY:7:21:00" / "MANUAL:0:00:00" etc.
export async function applyReminderPreset(ctx: Context, code: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const wasOnboarding = !user.onboardingDone;

  const [freqRaw, dayRaw, time] = code.split(":") as [string, string, string?];
  const frequency = freqRaw as ReminderFrequency;

  const data: Parameters<typeof prisma.user.update>[0]["data"] = {
    reminderFrequency: frequency,
    state: UserState.READY
  };
  if (frequency === ReminderFrequency.MANUAL) {
    data.reminderDay = null;
    data.reminderTime = null;
  } else {
    data.reminderDay = Number(dayRaw) || null;
    data.reminderTime = time && /^\d{2}:\d{2}$/.test(time) ? time : null;
  }

  await prisma.user.update({ where: { id: user.id }, data });

  if (wasOnboarding) {
    await markOnboardingReady(user.id);
    track("onboarding_completed", { userId: user.id });
  }

  await ctx.reply(presetConfirmation(frequency, dayRaw, time));
}

function presetConfirmation(freq: string, dayRaw: string | undefined, time: string | undefined): string {
  if (freq === "MANUAL") return "Хорошо. Возвращайся когда захочешь — пиши, я отвечу.";
  if (freq === "MONTHLY") return `Хорошо. Напомню раз в две-три недели${time ? ` в ${time}` : ""}.`;
  const day = dayRaw ? DAY_NAMES_RU[Number(dayRaw)] : null;
  return day && time ? `Хорошо. Напомню ${day} в ${time}.` : "Хорошо. Напомню через неделю.";
}
