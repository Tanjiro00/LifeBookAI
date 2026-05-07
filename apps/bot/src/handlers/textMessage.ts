import type { Context } from "grammy";
import { handleWeeklyText } from "../conversations/weeklyEntry.js";
import { isSensitiveAdviceRequest } from "../lib/errors.js";

export async function handleTextMessage(ctx: Context): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith("/")) return;

  if (isSensitiveAdviceRequest(text) && /что делать|посоветуй|advice|what should/i.test(text)) {
    await ctx.reply(
      [
        "Я не терапевт и не врач — медицинских или психологических советов не даю.",
        "",
        "Но я могу бережно записать этот период как часть твоей книги: что произошло, кто был рядом, что хочется не потерять."
      ].join("\n")
    );
    return;
  }

  // The bot has no remaining "wait for typed onboarding answer" states. Any text is treated
  // as a weekly entry; subscriptions.canCreateEntry decides whether to gate or accept it.
  await handleWeeklyText(ctx, text);
}
