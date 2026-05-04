import type { Chapter } from "@prisma/client";
import type { Context } from "grammy";
import { StyleAdjustmentSchema } from "@lifebook/ai";
import { chapterActionsKeyboard, savedChapterKeyboard } from "../keyboards/chapterActions.js";
import { adjustAndPersistChapter, saveChapter } from "../services/chapterService.js";
import { formatChapterForTelegram, formatSavedChapterText } from "../services/formatting.js";
import { chapterPreviewUrl, renderAndStoreChapterCard } from "../services/storage.js";
import { getSavedChapterCount } from "../services/userService.js";
import { ensureTelegramUser } from "../services/userService.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { replyWithFriendlyError } from "../lib/errors.js";

export async function sendChapterResult(ctx: Context, chapter: Chapter): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const chapterNumber = (await getSavedChapterCount(user.id)) + 1;
  const previewUrl = chapterPreviewUrl(chapter.shareToken || chapter.id);

  try {
    const card = await renderAndStoreChapterCard(chapter, chapterNumber);
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { cardImageUrl: card.publicUrl }
    });
    await ctx.replyWithPhoto(card.inputFile);
  } catch (error) {
    logger.warn({ err: error, chapterId: chapter.id }, "Chapter card rendering failed");
  }

  await ctx.reply(formatChapterForTelegram(chapter, chapterNumber), {
    parse_mode: "HTML",
    reply_markup: chapterActionsKeyboard(chapter.id, previewUrl)
  });
}

export async function saveReviewedChapter(ctx: Context, chapterId: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const { chapter, savedCount } = await saveChapter(user, chapterId);
  const previewUrl = chapterPreviewUrl(chapter.shareToken || chapter.id);

  await ctx.reply(formatSavedChapterText(savedCount, reminderText(user.reminderDay, user.reminderTime)), {
    reply_markup: savedChapterKeyboard(chapter.id, previewUrl)
  });
}

export async function adjustReviewedChapter(ctx: Context, codeValue: string, chapterId: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const parsed = StyleAdjustmentSchema.safeParse(codeValue);

  if (!parsed.success) {
    await ctx.reply("Не понял, как именно переделать главу. Попробуй выбрать кнопку ещё раз.");
    return;
  }

  await ctx.reply("Сейчас перепишу главу, сохранив факты.");

  try {
    const chapter = await adjustAndPersistChapter(user, chapterId, parsed.data);
    await sendChapterResult(ctx, chapter);
  } catch (error) {
    await replyWithFriendlyError(ctx, error);
  }
}

function reminderText(day?: number | null, time?: string | null): string | null {
  if (!day || !time) {
    return null;
  }
  const labels: Record<number, string> = {
    1: "в понедельник",
    2: "во вторник",
    3: "в среду",
    4: "в четверг",
    5: "в пятницу",
    6: "в субботу",
    7: "в воскресенье"
  };
  return `${labels[day]} в ${time}`;
}
