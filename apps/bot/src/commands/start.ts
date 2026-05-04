import type { Context } from "grammy";
import { mainMenuKeyboard, startKeyboard } from "../keyboards/mainMenu.js";
import { ensureTelegramUser, getSavedChapterCount } from "../services/userService.js";
import { getLatestSavedChapter } from "../services/bookService.js";
import { track } from "../services/analytics.js";

export async function sendStart(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  track("bot_started", { userId: user.id });

  if (user.onboardingDone) {
    const [count, latest] = await Promise.all([getSavedChapterCount(user.id), getLatestSavedChapter(user.id)]);
    await ctx.reply(
      [
        "Твоя книга продолжается.",
        "",
        `Сейчас в ней: ${count} глав${count === 1 ? "а" : count > 1 && count < 5 ? "ы" : ""}.`,
        latest ? `Последняя глава: “${latest.title}”.` : "Первая глава ещё ждёт своего момента.",
        "",
        "Что хочешь сделать?"
      ].join("\n"),
      { reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  await ctx.reply(
    [
      "Привет. Я помогу тебе собрать книгу твоей жизни.",
      "",
      "Раз в неделю ты просто рассказываешь, что произошло — текстом или голосом. Я задам пару вопросов и превращу это в красивую главу.",
      "",
      "Через год у тебя будет не хаос воспоминаний, а настоящая книга о себе."
    ].join("\n"),
    { reply_markup: startKeyboard() }
  );
}

