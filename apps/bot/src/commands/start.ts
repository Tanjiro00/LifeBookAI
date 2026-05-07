import type { Context } from "grammy";
import { InputFile } from "grammy";
import { UserState } from "@prisma/client";
import { ensureTelegramUser } from "../services/userService.js";
import { getSampleEntryCardPath } from "../services/storage.js";
import { track } from "../services/analytics.js";
import { prisma } from "../lib/db.js";

// /start — for first-time users: a real example of what the bot produces, plus
// the contract in 3 sentences. For returning users: a tiny status nudge.
export async function sendStart(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  track("bot_started", { userId: user.id });

  if (!user.onboardingDone) {
    await prisma.user.update({
      where: { id: user.id },
      data: { state: UserState.WAITING_FOR_WEEKLY_INPUT }
    });

    const samplePath = await getSampleEntryCardPath();
    const caption = [
      "Привет.",
      "",
      "Я складываю твой год в книгу. Не дневник, не журнал — настоящую прозу про твою жизнь.",
      "",
      "Раз в неделю ты рассказываешь один момент — голосом или текстом, как удобно. Я превращаю его в страницу вроде той, что выше. К декабрю — 52 записи, AI-обложка и красивая книга твоего года в PDF.",
      "",
      "Расскажи первый момент: что было на этой неделе?"
    ].join("\n");

    await ctx.replyWithPhoto(new InputFile(samplePath), { caption });
    return;
  }

  // Returning user: short status, voice/text input is the CTA.
  const [count, latest] = await Promise.all([
    prisma.page.count({ where: { userId: user.id } }),
    prisma.page.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { sceneTitle: true }
    })
  ]);

  const lines: string[] = [];
  if (count === 0) {
    lines.push("Книга пока пустая. Расскажи момент — открою первую страницу.");
  } else {
    lines.push(`${count} из 52 записей в твоей книге.`);
    if (latest) lines.push(`Последняя — «${latest.sceneTitle}».`);
  }
  lines.push("", "Какой момент сохраним сейчас?");

  await ctx.reply(lines.join("\n"));
}
