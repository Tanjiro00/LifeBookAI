import { UserState } from "@prisma/client";
import type { Context } from "grammy";
import { handleCustomReminderTime } from "../conversations/onboarding.js";
import { handleWeeklyText } from "../conversations/weeklyEntry.js";
import { ensureTelegramUser } from "../services/userService.js";
import { isSensitiveAdviceRequest } from "../lib/errors.js";

export async function handleTextMessage(ctx: Context): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith("/")) {
    return;
  }

  if (isSensitiveAdviceRequest(text) && /что делать|посоветуй|advice|what should/i.test(text)) {
    await ctx.reply(
      [
        "Я не терапевт и не врач, поэтому не буду давать медицинские или психологические советы.",
        "",
        "Но я могу помочь бережно записать этот период как часть твоей истории: что произошло, кто был рядом, что ты хочешь сохранить на странице."
      ].join("\n")
    );
    return;
  }

  if (await handleCustomReminderTime(ctx, text)) {
    return;
  }

  const user = await ensureTelegramUser(ctx);
  if (user.state === UserState.NEW_USER || user.state.startsWith("ONBOARDING")) {
    await ctx.reply("Лучше выбери один из вариантов кнопкой. Так книга сразу настроится правильно.");
    return;
  }

  await handleWeeklyText(ctx, text);
}

