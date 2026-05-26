import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { EntryStatus, UserState, type Entry } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { t } from "../lib/i18n.js";
import { track } from "../services/analytics.js";
import { releaseLock } from "../lib/locks.js";

// Sprint 0.5 — Voice transcript confirmation.
//
// Why this exists:
//   The previous voice flow took whatever Whisper produced and immediately fed it
//   to the AI biographer. If the model misheard «Аня» as «Ваня» — that mistake
//   became a permanent biographical fact ("я встретился с Ваней"). Worse, the
//   user never saw the transcript, so they had no way to know.
//
// New flow:
//   1. transcribe → present the transcript with [✅ Да, писать страницу] [✏️ Поправить]
//   2. on confirm → mark Entry.transcriptConfirmed=true, finalInputText=transcript,
//      hand off to the existing finalize-or-questions path.
//   3. on edit → set state AWAITING_TRANSCRIPT_CONFIRM, ask user to send corrected
//      text. Their next text reply replaces transcript and moves on.
//
// The confirmation is not just a UX sugar — it's the gate before generation. Per
// master spec §6.1: «До подтверждения не создавать Page и не извлекать memories.»

export const TRANSCRIPT_CONFIRM_PREFIX = "tx:confirm:";
export const TRANSCRIPT_EDIT_PREFIX = "tx:edit:";

// Long transcripts get clipped in the prompt-message body so the buttons stay
// reachable, but the full transcript stays in the DB.
const PROMPT_TRANSCRIPT_MAX_CHARS = 1500;

export async function presentTranscriptForConfirmation(
  ctx: Context,
  entry: Pick<Entry, "id" | "transcript" | "userId">
): Promise<void> {
  const transcript = (entry.transcript ?? "").trim();
  if (!transcript) {
    await ctx.reply(
      t(
        ctx,
        "Не получилось расслышать голосовое. Попробуй записать ещё раз или пришли текстом.",
        "I couldn't make out the voice message. Send it again or write it as text."
      )
    );
    return;
  }

  await prisma.user.update({
    where: { id: entry.userId },
    data: { state: UserState.AWAITING_TRANSCRIPT_CONFIRM }
  });

  const shown =
    transcript.length > PROMPT_TRANSCRIPT_MAX_CHARS
      ? transcript.slice(0, PROMPT_TRANSCRIPT_MAX_CHARS).trimEnd() + "…"
      : transcript;

  const kb = new InlineKeyboard()
    .text(t(ctx, "✅ Да, писать страницу", "✅ Yes, write the page"), `${TRANSCRIPT_CONFIRM_PREFIX}${entry.id}`)
    .row()
    .text(t(ctx, "✏️ Поправить", "✏️ Edit"), `${TRANSCRIPT_EDIT_PREFIX}${entry.id}`);

  const intro = t(ctx, "Я услышал так:", "I heard this:");
  await ctx.reply(`${intro}\n\n«${shown}»`, { reply_markup: kb });

  track("transcript_shown", {
    userId: entry.userId,
    entryId: entry.id,
    length: transcript.length
  });
}

// Imported lazily inside callback to avoid a cycle: weeklyEntry depends on
// pageDeliveryService (Sprint 0.2) and on this module (Sprint 0.5), and proceedAfterConfirmedTranscript
// re-enters the weeklyEntry pipeline.
async function proceedAfterConfirmedTranscript(
  ctx: Context,
  entry: Entry,
  user: Awaited<ReturnType<typeof import("../services/userService.js").ensureTelegramUser>>
): Promise<void> {
  const { proceedFromConfirmedEntry } = await import("./weeklyEntry.js");
  await proceedFromConfirmedEntry(ctx, entry, user);
}

// Callback handler for «✅ Да, писать страницу».
export async function handleConfirmTranscript(ctx: Context, entryId: string): Promise<void> {
  const { ensureTelegramUser } = await import("../services/userService.js");
  const user = await ensureTelegramUser(ctx);
  const entry = await prisma.entry.findFirst({ where: { id: entryId, userId: user.id } });
  if (!entry) {
    await ctx.reply(t(ctx, "Эта запись уже не активна.", "This entry is no longer active."));
    return;
  }
  if (entry.transcriptConfirmed) {
    // Idempotent — user double-tapped. Just nudge them.
    await ctx.reply(t(ctx, "Уже пишу страницу.", "Already writing the page."));
    return;
  }

  const transcript = (entry.transcript ?? "").trim();
  const updated = await prisma.entry.update({
    where: { id: entry.id },
    data: {
      transcriptConfirmed: true,
      finalInputText: transcript
    }
  });
  track("transcript_confirmed", { userId: user.id, entryId: entry.id });
  await proceedAfterConfirmedTranscript(ctx, updated, user);
}

// Callback handler for «✏️ Поправить» — sets state and asks for corrected text.
export async function handleRequestTranscriptCorrection(ctx: Context, entryId: string): Promise<void> {
  const { ensureTelegramUser } = await import("../services/userService.js");
  const user = await ensureTelegramUser(ctx);
  const entry = await prisma.entry.findFirst({ where: { id: entryId, userId: user.id } });
  if (!entry) {
    await ctx.reply(t(ctx, "Эта запись уже не активна.", "This entry is no longer active."));
    return;
  }
  // Stash the entryId in the user state via a pending-key-style approach is
  // overkill here — there's at most one in-flight unconfirmed transcript per
  // user (the earlier voice lock guarantees this), so we just look it up by
  // status when the corrected text arrives.
  await prisma.user.update({
    where: { id: user.id },
    data: { state: UserState.AWAITING_TRANSCRIPT_CONFIRM }
  });
  await ctx.reply(
    t(
      ctx,
      "Пришли текст в исправленном виде — я заменю транскрипт твоими словами и продолжу.",
      "Send the corrected text — I'll replace the transcript with your version and continue."
    )
  );
}

// Called from the text-message handler when user.state === AWAITING_TRANSCRIPT_CONFIRM
// and the user replies with corrected text.
export async function applyTranscriptCorrection(ctx: Context, correctedText: string): Promise<void> {
  const { ensureTelegramUser } = await import("../services/userService.js");
  const user = await ensureTelegramUser(ctx);

  // Find the latest unconfirmed entry for this user.
  const entry = await prisma.entry.findFirst({
    where: {
      userId: user.id,
      transcriptConfirmed: false,
      status: EntryStatus.COLLECTED
    },
    orderBy: { createdAt: "desc" }
  });
  if (!entry) {
    // Nothing to attach the correction to — drop into normal text-as-entry flow.
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    const { handleWeeklyText } = await import("./weeklyEntry.js");
    await handleWeeklyText(ctx, correctedText);
    return;
  }

  const updated = await prisma.entry.update({
    where: { id: entry.id },
    data: {
      transcript: correctedText,
      finalInputText: correctedText,
      transcriptConfirmed: true
    }
  });
  track("transcript_corrected", {
    userId: user.id,
    entryId: entry.id,
    originalLength: (entry.transcript ?? "").length,
    correctedLength: correctedText.length
  });
  await proceedAfterConfirmedTranscript(ctx, updated, user);
}

// Lightweight cancel — mirrors the existing entry cancel path. Used when the
// user issues /cancel mid-confirmation.
export async function abandonTranscriptConfirmation(ctx: Context, entryId: string): Promise<void> {
  const { ensureTelegramUser } = await import("../services/userService.js");
  const user = await ensureTelegramUser(ctx);
  await prisma.entry.updateMany({
    where: { id: entryId, userId: user.id, transcriptConfirmed: false },
    data: { status: EntryStatus.ARCHIVED }
  });
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
  await releaseLock(`voice:${user.id}`);
  await releaseLock(`entry:${user.id}`);
  logger.info({ userId: user.id, entryId }, "transcript confirmation abandoned");
}
