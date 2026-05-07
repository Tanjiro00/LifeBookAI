import { EntryStatus, UserState, type Page } from "@prisma/client";
import type { Context } from "grammy";
import { transcribeAudio } from "@lifebook/ai";
import { createPageForEntry } from "../services/pageService.js";
import { ensureTelegramUser } from "../services/userService.js";
import { canCreateEntry, FREE_ENTRY_LIMIT, isProActive, paywallText } from "../services/subscriptions.js";
import { downloadTelegramFile } from "../services/telegramFiles.js";
import { renderAndStoreEntryCard, bookPreviewUrl } from "../services/storage.js";
import { ensureBookArtifacts } from "../services/bookComposer.js";
import { reminderPresetKeyboard } from "../keyboards/onboarding.js";
import { paywallKeyboard } from "../keyboards/settings.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { track } from "../services/analytics.js";
import { replyWithFriendlyError } from "../lib/errors.js";
import { acquireLock, releaseLock } from "../lib/locks.js";
import { isTelegramInlineUrl } from "../services/urls.js";
import { InlineKeyboard } from "grammy";

async function sendTyping(ctx: Context): Promise<void> {
  if (ctx.chat) await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
}

// One ephemeral status. No theme extraction shown to user, no chained progress messages.
async function announceWriting(ctx: Context): Promise<void> {
  await sendTyping(ctx);
  await ctx.reply("Пишу страницу…");
}

async function sendEntryResult(ctx: Context, page: Page): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const totalSlots = 52;

  // Render and send the entry card.
  try {
    const card = await renderAndStoreEntryCard(page, totalSlots);
    await prisma.page.update({ where: { id: page.id }, data: { cardImageUrl: card.publicUrl } });

    const entryNumber = await prisma.page.count({ where: { userId: user.id } });
    const book = await prisma.book.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { shareToken: true }
    });

    const caption = `${page.sceneTitle}\n\nЗапись ${entryNumber} из ${totalSlots}`;
    const keyboard = book?.shareToken
      ? (() => {
          const url = bookPreviewUrl(book.shareToken!);
          return isTelegramInlineUrl(url)
            ? new InlineKeyboard().url("Открыть мою книгу", url)
            : new InlineKeyboard().text("Открыть мою книгу", "menu:book");
        })()
      : null;

    await ctx.replyWithPhoto(card.inputFile, {
      caption,
      ...(keyboard ? { reply_markup: keyboard } : {})
    });
  } catch (error) {
    logger.warn({ err: { message: (error as Error).message }, pageId: page.id }, "Entry card render failed");
    // Fallback to plain text — should be rare.
    await ctx.reply(`${page.sceneTitle}\n\n${page.sceneContent}`);
  }

  // Onboarding nudge ONLY for the very first entry. Single question, four buttons.
  if (!user.onboardingDone) {
    await ctx.reply("Возвращаться раз в неделю? Я напомню.", { reply_markup: reminderPresetKeyboard() });
    return;
  }

  // Reset state for the next entry.
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
}

async function chargePaywall(ctx: Context, freeUsed: number): Promise<void> {
  track("paywall_shown", { userId: ctx.from?.id ? String(ctx.from.id) : "unknown" });
  await ctx.reply(paywallText(freeUsed), { reply_markup: paywallKeyboard() });
}

async function preflightCheck(ctx: Context, user: Awaited<ReturnType<typeof ensureTelegramUser>>): Promise<boolean> {
  // Free-tier limiter: 4 entries are free. Beyond that, paywall.
  if (!canCreateEntry(user)) {
    await chargePaywall(ctx, user.freeEntriesUsed);
    return false;
  }
  return true;
}

async function bumpFreeUsage(userId: string, isPro: boolean): Promise<void> {
  if (isPro) return;
  await prisma.user.update({
    where: { id: userId },
    data: { freeEntriesUsed: { increment: 1 } }
  });
}

export async function handleWeeklyText(ctx: Context, text: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);

  const acceptable: UserState[] = [
    UserState.NEW_USER,
    UserState.READY,
    UserState.WAITING_FOR_WEEKLY_INPUT,
    UserState.CHAPTER_SAVED
  ];
  if (!acceptable.includes(user.state)) {
    await ctx.reply("Сейчас я в середине другой записи. Если хочешь начать заново — нажми /new или /cancel.");
    return;
  }

  if (text.trim().length < 20) {
    await ctx.reply("Слишком коротко. Добавь пару деталей: что произошло, кто был рядом, что хочется запомнить.");
    return;
  }

  if (!(await preflightCheck(ctx, user))) return;

  const lockKey = `entry:${user.id}`;
  if (!(await acquireLock(lockKey, 120_000))) {
    await ctx.reply("Я ещё дописываю предыдущую страницу. Минуту — и эту тоже добавлю.");
    return;
  }

  track("text_entry_received", { userId: user.id, length: text.length });
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.GENERATING_CHAPTER } });
  await announceWriting(ctx);

  try {
    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        rawText: text,
        status: EntryStatus.COLLECTED,
        periodEnd: new Date(),
        periodStart: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
      }
    });
    const page = await createPageForEntry(user, entry);
    await bumpFreeUsage(user.id, isProActive(user));
    await sendEntryResult(ctx, page);
    // Best-effort: spin up AI title + cover in background once we have ≥3 entries.
    void ensureBookArtifacts(user.id).catch(() => {});
  } catch (error) {
    await replyWithFriendlyError(ctx, error);
  } finally {
    await releaseLock(lockKey);
  }
}

export async function handleVoiceMessage(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const voice = ctx.message?.voice;
  if (!voice) return;

  if (!(await preflightCheck(ctx, user))) return;

  const lockKey = `voice:${user.id}`;
  if (!(await acquireLock(lockKey, 180_000))) {
    await ctx.reply("Я ещё дослушиваю предыдущее голосовое. Минуту.");
    return;
  }

  track("voice_entry_received", { userId: user.id, duration: voice.duration });
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.TRANSCRIBING_AUDIO } });
  await announceWriting(ctx);

  try {
    const downloaded = await downloadTelegramFile(ctx, voice.file_id);
    const transcript = await transcribeAudio(downloaded.filePath);

    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        telegramVoiceId: voice.file_id,
        audioUrl: downloaded.publicPath,
        transcript: transcript.transcript,
        status: EntryStatus.COLLECTED,
        periodEnd: new Date(),
        periodStart: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
      }
    });
    track("voice_transcribed", { userId: user.id, entryId: entry.id });

    const page = await createPageForEntry(user, entry);
    await bumpFreeUsage(user.id, isProActive(user));
    await sendEntryResult(ctx, page);
    void ensureBookArtifacts(user.id).catch(() => {});
  } catch (error) {
    await replyWithFriendlyError(ctx, error);
  } finally {
    await releaseLock(lockKey);
  }
}

// Convenience for `/new` command — sends the same prompt the reminder uses.
export async function promptForNewEntry(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  if (!canCreateEntry(user)) {
    await chargePaywall(ctx, user.freeEntriesUsed);
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.WAITING_FOR_WEEKLY_INPUT } });
  await ctx.reply("Какой момент сохраним?\n\nГолосом — быстрее всего.");
}

// Used by the `_FREE_ENTRY_LIMIT` consumer in commands; re-export for callers.
export { FREE_ENTRY_LIMIT };
