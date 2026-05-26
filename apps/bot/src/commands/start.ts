import type { Context } from "grammy";
import { InputFile } from "grammy";
import { UserState } from "@prisma/client";
import { ensureTelegramUser } from "../services/userService.js";
import { getSampleEntryCardPath } from "../services/storage.js";
import { mainMenuKeyboard } from "../keyboards/mainMenu.js";
import { reminderPresetKeyboard } from "../keyboards/onboarding.js";
import { identifyUser, track } from "../services/analytics.js";
import { prisma } from "../lib/db.js";
import { t } from "../lib/i18n.js";

// /start — for first-time users:
//   1. Photo of a sample card + 3-sentence pitch.
//   2. Reminder-frequency picker UPFRONT (collected once; never shown after entries).
//   3. After preset → onboarding intake (7 questions) → AI Prologue → ready for weekly entries.
// For returning users: condensed status + persistent menu.
export async function sendStart(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  identifyUser(user.id, {
    languageCode: user.languageCode,
    onboardingDone: user.onboardingDone,
    isPaid: user.isPaid,
    createdAt: user.createdAt,
    state: user.state
  });
  track("bot_started", { userId: user.id });

  if (!user.onboardingDone) {
    await prisma.user.update({
      where: { id: user.id },
      data: { state: UserState.ONBOARDING_REMINDER_TIME }
    });

    const samplePath = await getSampleEntryCardPath();
    const caption = t(
      ctx,
      [
        "Привет.",
        "",
        "Я — твой биограф. Не дневник и не журнал, а один человек, который пишет твою книгу.",
        "",
        "Это книга про твою жизнь — с прологом про тебя до этого года, и страницами по моменту в неделю до декабря.",
        "",
        "Прежде чем начать — выбери, как часто я буду напоминать."
      ].join("\n"),
      [
        "Hi.",
        "",
        "I'm your biographer. Not a diary, not a journal — one person writing your book.",
        "",
        "It's a book about your life: a prologue about who you were before this year, then one page per week until December.",
        "",
        "Before we start — pick how often I should nudge you."
      ].join("\n")
    );

    await ctx.replyWithPhoto(new InputFile(samplePath), { caption });
    await ctx.reply(
      t(ctx, "Когда тебе удобно возвращаться?", "When's a good rhythm for you?"),
      { reply_markup: reminderPresetKeyboard(ctx) }
    );
    return;
  }

  // Returning user — condensed status.
  const [count, latest] = await Promise.all([
    prisma.page.count({ where: { userId: user.id, kind: "WEEKLY" } }),
    prisma.page.findFirst({
      where: { userId: user.id, kind: "WEEKLY" },
      orderBy: { createdAt: "desc" },
      select: { sceneTitle: true }
    })
  ]);

  const lines: string[] = [];
  if (count === 0) {
    lines.push(
      t(
        ctx,
        "Книга пока с прологом. Расскажи момент этой недели — открою первую страницу.",
        "The book has its prologue. Tell me this week's moment — I'll open page one."
      )
    );
  } else {
    lines.push(
      t(ctx, `${count} из 52 страниц в твоей книге.`, `${count} of 52 pages in your book.`)
    );
    if (latest) {
      lines.push(t(ctx, `Последняя — «${latest.sceneTitle}».`, `Most recent — "${latest.sceneTitle}".`));
    }
  }
  lines.push("", t(ctx, "Какой момент сохраним сейчас?", "Which moment should we keep now?"));

  await ctx.reply(lines.join("\n"), { reply_markup: mainMenuKeyboard(ctx) });
}
