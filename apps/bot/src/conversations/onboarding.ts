import { ReminderFrequency } from "@prisma/client";
import type { Context } from "grammy";
import { goalKeyboard, privacyKeyboard, styleKeyboard, frequencyKeyboard, dayKeyboard, timeKeyboard, GOAL_LABELS, STYLE_LABELS } from "../keyboards/onboarding.js";
import {
  ensureTelegramUser,
  markOnboardingReady,
  updateReminderDay,
  updateReminderFrequency,
  updateReminderTime,
  updateWritingGoal,
  updateWritingStyle
} from "../services/userService.js";
import { prisma } from "../lib/db.js";
import { track } from "../services/analytics.js";
import { sendNewChapterPrompt } from "../commands/new.js";

export async function beginOnboarding(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  await prisma.user.update({ where: { id: user.id }, data: { state: "ONBOARDING_GOAL" } });
  track("onboarding_started", { userId: user.id });
  await ctx.reply("Для кого ты хочешь писать эту книгу?", { reply_markup: goalKeyboard() });
}

export async function chooseGoal(ctx: Context, value: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  await updateWritingGoal(user.id, GOAL_LABELS[value] || value);
  await ctx.reply("Каким должен быть стиль твоей книги?", { reply_markup: styleKeyboard() });
}

export async function chooseStyle(ctx: Context, value: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  await updateWritingStyle(user.id, STYLE_LABELS[value] || value);
  await ctx.reply("Как часто напоминать тебе написать новую главу?", { reply_markup: frequencyKeyboard() });
}

export async function chooseFrequency(ctx: Context, value: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const frequency = value as ReminderFrequency;
  await updateReminderFrequency(user.id, frequency);

  if (frequency === ReminderFrequency.MANUAL) {
    await ctx.reply(
      ["Важно: твои главы приватны по умолчанию.", "", "Ты сам решаешь, что сохранять, удалять или отправлять другим."].join("\n"),
      { reply_markup: privacyKeyboard() }
    );
    return;
  }

  await ctx.reply("В какой день удобнее?", { reply_markup: dayKeyboard() });
}

export async function chooseReminderDay(ctx: Context, value: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const day = Number.parseInt(value, 10);
  await updateReminderDay(user.id, day);
  await ctx.reply("В какое время?", { reply_markup: timeKeyboard() });
}

export async function chooseReminderTime(ctx: Context, value: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);

  if (value === "custom") {
    await ctx.reply("Напиши время в формате 21:30.");
    return;
  }

  await updateReminderTime(user.id, value);
  await ctx.reply(
    ["Важно: твои главы приватны по умолчанию.", "", "Ты сам решаешь, что сохранять, удалять или отправлять другим."].join("\n"),
    { reply_markup: privacyKeyboard() }
  );
}

export async function handleCustomReminderTime(ctx: Context, timeText: string): Promise<boolean> {
  const user = await ensureTelegramUser(ctx);
  if (user.state !== "ONBOARDING_REMINDER_TIME") {
    return false;
  }

  if (!/^\d{2}:\d{2}$/.test(timeText)) {
    await ctx.reply("Нужно время в формате 21:30.");
    return true;
  }

  await updateReminderTime(user.id, timeText);
  await ctx.reply(
    ["Важно: твои главы приватны по умолчанию.", "", "Ты сам решаешь, что сохранять, удалять или отправлять другим."].join("\n"),
    { reply_markup: privacyKeyboard() }
  );
  return true;
}

export async function finishOnboarding(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  await markOnboardingReady(user.id);
  track("onboarding_completed", { userId: user.id });
  await ctx.reply("Готово. Начнём с первой главы.");
  await sendNewChapterPrompt(ctx);
}

