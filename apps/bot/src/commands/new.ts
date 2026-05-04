import { UserState } from "@prisma/client";
import type { Context } from "grammy";
import { weeklyPromptKeyboard } from "../keyboards/mainMenu.js";
import { paywallKeyboard } from "../keyboards/settings.js";
import { goalKeyboard } from "../keyboards/onboarding.js";
import { ensureTelegramUser } from "../services/userService.js";
import { canCreateAnotherChapter, freeLimitText } from "../services/subscriptions.js";
import { prisma } from "../lib/db.js";
import { track } from "../services/analytics.js";

export async function sendNewChapterPrompt(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);

  if (!user.onboardingDone) {
    await ctx.reply("Сначала настроим твою книгу — это займёт меньше минуты.");
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.ONBOARDING_GOAL } });
    await ctx.reply("Для кого ты хочешь писать эту книгу?", { reply_markup: goalKeyboard() });
    return;
  }

  if (!(await canCreateAnotherChapter(user))) {
    track("paywall_shown", { userId: user.id });
    await ctx.reply(freeLimitText(), { reply_markup: paywallKeyboard() });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { state: UserState.WAITING_FOR_WEEKLY_INPUT }
  });
  track("entry_started", { userId: user.id });

  await ctx.reply(
    [
      "Время новой главы.",
      "",
      "Что произошло на этой неделе? Можешь написать текстом или просто отправить голосовое.",
      "",
      "Не нужно красиво. Расскажи как есть — я помогу превратить это в историю."
    ].join("\n"),
    { reply_markup: weeklyPromptKeyboard() }
  );
}
