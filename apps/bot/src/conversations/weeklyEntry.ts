import { EntryStatus, UserState, type Entry, type Page } from "@prisma/client";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { generateQuestions, transcribeAudio } from "@lifebook/ai";
import { createPageForEntry } from "../services/pageService.js";
import { ensureTelegramUser } from "../services/userService.js";
import { canCreateEntry, FREE_ENTRY_LIMIT, isProActive, paywallText } from "../services/subscriptions.js";
import { downloadTelegramFile } from "../services/telegramFiles.js";
import { ensureBookArtifacts } from "../services/bookComposer.js";
import { mainMenuKeyboard } from "../keyboards/mainMenu.js";
import { refreshLifeContext } from "../services/lifeContextService.js";
import { paywallKeyboard } from "../keyboards/settings.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { track } from "../services/analytics.js";
import { replyWithFriendlyError } from "../lib/errors.js";
import { acquireLock, releaseLock } from "../lib/locks.js";
import { config } from "../config.js";
import { isEnglish, t } from "../lib/i18n.js";
import { streakMilestoneText, updateStreak } from "../services/streakService.js";
// Sprint 0.2 — delivery contract lives behind a single service.
import { deliverWeeklyPage } from "../services/pageDeliveryService.js";
// Sprint 0.5 — voice transcript confirmation gate.
import { presentTranscriptForConfirmation } from "./transcriptConfirmation.js";
// Sprint 1.7 — manuscript context for clarification questions.
import { buildNarrativeContext } from "../services/context/buildNarrativeContext.js";

const ENTRY_LOCK_TTL_MS = 5 * 60 * 1000; // long enough to cover follow-up answer wait

type StatusHandle = {
  chatId: number;
  messageId: number;
  refreshTimer: NodeJS.Timeout;
};

async function sendChatActionLoop(ctx: Context): Promise<NodeJS.Timeout> {
  if (ctx.chat) await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
  return setInterval(() => {
    if (ctx.chat) ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
  }, 4000);
}

// Posts the initial status message ("listening / thinking / writing") with a cancel
// button. Returns a handle so subsequent stages can edit the same message instead of
// spamming new ones.
async function openStatus(ctx: Context, entryId: string, initial: "listening" | "thinking" | "writing"): Promise<StatusHandle | null> {
  if (!ctx.chat) return null;
  const text = phaseText(ctx, initial);
  const kb = new InlineKeyboard().text(t(ctx, "❌ Отменить", "❌ Cancel"), `entry:cancel:${entryId}`);
  const refreshTimer = await sendChatActionLoop(ctx);
  const msg = await ctx.reply(text, { reply_markup: kb });
  return { chatId: ctx.chat.id, messageId: msg.message_id, refreshTimer };
}

async function updateStatus(ctx: Context, handle: StatusHandle | null, phase: "thinking" | "writing"): Promise<void> {
  if (!handle) return;
  // Strip the inline keyboard by passing an empty `inline_keyboard`. We can't pass
  // `reply_markup: undefined` under exactOptionalPropertyTypes — the Telegram API
  // also doesn't accept null. An empty keyboard is the canonical "no buttons".
  await ctx.api
    .editMessageText(handle.chatId, handle.messageId, phaseText(ctx, phase), {
      reply_markup: { inline_keyboard: [] }
    })
    .catch(() => {});
}

async function closeStatus(ctx: Context, handle: StatusHandle | null, finalText?: string): Promise<void> {
  if (!handle) return;
  clearInterval(handle.refreshTimer);
  if (finalText) {
    await ctx.api.editMessageText(handle.chatId, handle.messageId, finalText).catch(() => {});
  } else {
    // Remove the status entirely so the card stands alone.
    await ctx.api.deleteMessage(handle.chatId, handle.messageId).catch(() => {});
  }
}

function phaseText(ctx: Context, phase: "listening" | "thinking" | "writing"): string {
  switch (phase) {
    case "listening":
      return t(ctx, "🎙 Слушаю…", "🎙 Listening…");
    case "thinking":
      return t(ctx, "✍️ Думаю…", "✍️ Thinking…");
    case "writing":
      return t(ctx, "📖 Пишу страницу…", "📖 Writing your page…");
  }
}

// ── result delivery ─────────────────────────────────────────────────────────

// Sprint 0.1 — Delivery rewrite.
//
// OLD behaviour (removed):  poster card + (sometimes) full body in chat + book button.
// NEW behaviour:            ONE poster card + 4 inline buttons (Open page / Revise /
//                            Title / Memories), full body lives only in the Mini App.
//
// The streak milestone, which used to be appended to the photo caption, is now
// sent as a tiny separate message AFTER the card so it doesn't compete with the
// page's title for visual priority.
async function sendEntryResult(ctx: Context, page: Page): Promise<void> {
  const user = await ensureTelegramUser(ctx);

  // Streak update after the page is committed.
  let milestoneSuffix: string | null = null;
  try {
    const { streak, milestoneHit } = await updateStreak(user.id);
    if (milestoneHit) {
      milestoneSuffix = streakMilestoneText(streak, isEnglish(ctx) ? "en" : "ru");
    }
  } catch (err) {
    logger.warn({ err }, "streak update failed (non-fatal)");
  }

  // The single delivery point. pageDeliveryService owns everything about what
  // a user sees in chat for a Page: PNG, caption, inline buttons, fallback.
  await deliverWeeklyPage(ctx, page);

  if (milestoneSuffix) {
    await ctx.reply(milestoneSuffix);
  }

  // Reset state so menu buttons + new entries work immediately.
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });

  // Persistent menu reaffirmed after each entry result. The reminder picker is
  // collected ONCE at /start, never again — moving it here was the bug that made
  // it reappear after every entry.
  await ctx.reply(t(ctx, "Что дальше?", "What's next?"), { reply_markup: mainMenuKeyboard(ctx) });
}

// ── paywall + preflight ────────────────────────────────────────────────────

async function chargePaywall(ctx: Context, freeUsed: number): Promise<void> {
  track("paywall_shown", { userId: ctx.from?.id ? String(ctx.from.id) : "unknown" });
  await ctx.reply(paywallText(ctx, freeUsed), { reply_markup: paywallKeyboard(ctx) });
}

async function preflightCheck(ctx: Context, user: Awaited<ReturnType<typeof ensureTelegramUser>>): Promise<boolean> {
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

// ── follow-up question machinery ───────────────────────────────────────────

type FlowContext = {
  ctx: Context;
  status: StatusHandle | null;
  entry: Entry;
  user: Awaited<ReturnType<typeof ensureTelegramUser>>;
};

async function generateAndStoreQuestions(flow: FlowContext, sourceText: string): Promise<number> {
  const language = (flow.user.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";
  const memories = await prisma.memory.findMany({
    where: { userId: flow.user.id },
    take: 8,
    orderBy: { confidence: "desc" }
  });
  const recent = await prisma.page.findMany({
    where: { userId: flow.user.id, isCurrent: true },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { sceneTitle: true, tags: true, createdAt: true }
  });
  const now = Date.now();
  const recentForPrompt = recent.map((p) => ({
    title: p.sceneTitle,
    tags: p.tags,
    daysAgo: Math.max(0, Math.floor((now - p.createdAt.getTime()) / (24 * 60 * 60 * 1000)))
  }));

  // Sprint 1.7 — share the same manuscript context the writer will see, so
  // questions reference concrete prior scenes instead of asking generically.
  const context = await buildNarrativeContext({
    user: flow.user,
    currentEntryText: sourceText,
    rawText: flow.entry.rawText,
    transcript: flow.entry.transcript,
    entryType: "WEEKLY"
  });

  let result;
  try {
    result = await generateQuestions({
      rawEntryOrTranscript: sourceText,
      language,
      recentEntries: recentForPrompt,
      recentBodies: context.manuscriptContext.recentBodies.map((p) => ({
        pageId: p.pageId,
        title: p.title,
        body: p.body,
        daysAgo: p.daysAgo
      })),
      relatedBodies: context.manuscriptContext.relatedBodies.map((p) => ({
        pageId: p.pageId,
        title: p.title,
        body: p.body,
        daysAgo: p.daysAgo,
        similarity: p.similarity
      })),
      memories,
      count: config.FOLLOWUP_QUESTIONS_COUNT
    });
  } catch (err) {
    logger.warn({ err }, "generateQuestions failed (proceeding without follow-up)");
    return 0;
  }

  if (!result.questions.length) return 0;

  await prisma.$transaction(
    result.questions.map((q, i) =>
      prisma.clarificationQuestion.create({
        data: {
          entryId: flow.entry.id,
          question: q.question,
          reason: q.reason ?? null,
          sortOrder: i
        }
      })
    )
  );
  await prisma.entry.update({
    where: { id: flow.entry.id },
    data: { status: EntryStatus.QUESTIONS_GENERATED }
  });
  return result.questions.length;
}

async function postNextQuestion(ctx: Context, entryId: string, status: StatusHandle | null): Promise<boolean> {
  const next = await prisma.clarificationQuestion.findFirst({
    where: { entryId, answer: null },
    orderBy: { sortOrder: "asc" }
  });
  if (!next) return false;

  // Replace the status message with the question + skip button. Cancel is still implicit
  // via /cancel command; skip moves to the next question or finalizes.
  const kb = new InlineKeyboard()
    .text(t(ctx, "Пропустить", "Skip"), `q:skip:${next.id}`)
    .text(t(ctx, "Пропустить все", "Skip all"), `q:skipall:${entryId}`);
  if (status) {
    clearInterval(status.refreshTimer);
    await ctx.api.editMessageText(status.chatId, status.messageId, `❓ ${next.question}`, { reply_markup: kb }).catch(() => {});
  } else {
    await ctx.reply(`❓ ${next.question}`, { reply_markup: kb });
  }
  return true;
}

// Called from textMessage handler when user is in WAITING_FOR_ANSWERS state.
export async function handleAnswerForFollowup(ctx: Context, text: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);

  // Find the in-flight entry (most recent COLLECTED / QUESTIONS_GENERATED / ANSWERS_COLLECTED).
  const entry = await prisma.entry.findFirst({
    where: {
      userId: user.id,
      status: { in: [EntryStatus.COLLECTED, EntryStatus.QUESTIONS_GENERATED, EntryStatus.ANSWERS_COLLECTED] }
    },
    orderBy: { createdAt: "desc" }
  });
  if (!entry) {
    // No entry to attach the answer to — treat as a fresh entry.
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    await handleWeeklyText(ctx, text);
    return;
  }

  const next = await prisma.clarificationQuestion.findFirst({
    where: { entryId: entry.id, answer: null },
    orderBy: { sortOrder: "asc" }
  });
  if (!next) {
    // Race: nothing pending. Finalize.
    await finalizePage(ctx, user, entry);
    return;
  }

  await prisma.clarificationQuestion.update({
    where: { id: next.id },
    data: { answer: text, answeredAt: new Date() }
  });

  // Are there more questions?
  const remaining = await prisma.clarificationQuestion.count({
    where: { entryId: entry.id, answer: null }
  });
  if (remaining > 0) {
    await postNextQuestion(ctx, entry.id, null);
    return;
  }

  await prisma.entry.update({ where: { id: entry.id }, data: { status: EntryStatus.ANSWERS_COLLECTED } });
  await finalizePage(ctx, user, entry);
}

async function finalizePage(
  ctx: Context,
  user: Awaited<ReturnType<typeof ensureTelegramUser>>,
  entry: Entry
): Promise<void> {
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.GENERATING_CHAPTER } });
  const refreshTimer = await sendChatActionLoop(ctx);
  const writingMsg = await ctx.reply(phaseText(ctx, "writing")).catch(() => null);

  try {
    const fresh = await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } });
    if (fresh.status === EntryStatus.ARCHIVED) {
      await ctx.reply(t(ctx, "Запись была отменена.", "This entry was canceled."));
      return;
    }
    // Augment rawText with answers so generateEntry sees them as part of the input.
    const answers = await prisma.clarificationQuestion.findMany({
      where: { entryId: entry.id, NOT: { answer: null } },
      orderBy: { sortOrder: "asc" }
    });
    const augmented = answers.length
      ? [
          fresh.rawText || fresh.transcript || "",
          "",
          ...answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`)
        ].join("\n")
      : fresh.rawText || fresh.transcript || "";

    const entryForPage = answers.length
      ? { ...fresh, rawText: augmented }
      : fresh;
    const page = await createPageForEntry(user, entryForPage);
    await bumpFreeUsage(user.id, isProActive(user));
    await sendEntryResult(ctx, page);
    // Block-await artifacts so we can notify the user about new cover/title in
    // the same turn. ~5-10s for image generation; the page card was already sent.
    try {
      const artifact = await ensureBookArtifacts(user.id);
      if (artifact.coverGenerated) {
        await ctx.reply(
          t(
            ctx,
            "🎨 Я нарисовал обложку для твоей книги. Открой /book.",
            "🎨 I painted a cover for your book. Open /book to see it."
          )
        );
      } else if (artifact.titleGenerated) {
        await ctx.reply(
          t(
            ctx,
            "📚 Я предложил название для твоей книги. Открой /book или поменяй через /title.",
            "📚 I suggested a title for your book. Open /book or change it with /title."
          )
        );
      }
    } catch {
      // ensureBookArtifacts already logs; non-fatal.
    }

    // Periodically refresh the biographer's briefing (User.lifeContext) so future
    // pages keep accumulating a single narrative arc. Fire-and-forget — the
    // current page is already delivered.
    try {
      const weeklyCount = await prisma.page.count({ where: { userId: user.id, kind: "WEEKLY" } });
      if (weeklyCount > 0 && weeklyCount % 5 === 0) {
        void refreshLifeContext(user.id).catch(() => {});
      }
    } catch {
      // non-fatal
    }
  } catch (error) {
    await replyWithFriendlyError(ctx, error);
  } finally {
    clearInterval(refreshTimer);
    if (writingMsg && ctx.chat) await ctx.api.deleteMessage(ctx.chat.id, writingMsg.message_id).catch(() => {});
    await releaseLock(`entry:${user.id}`);
    await releaseLock(`voice:${user.id}`);
  }
}

// Cancel handler called from callbackQuery.
export async function cancelEntry(ctx: Context, entryId: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const entry = await prisma.entry.findFirst({ where: { id: entryId, userId: user.id } });
  if (!entry) {
    await ctx.reply(t(ctx, "Эта запись уже не активна.", "This entry is no longer active."));
    return;
  }
  await prisma.entry.update({ where: { id: entry.id }, data: { status: EntryStatus.ARCHIVED } });
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
  await releaseLock(`entry:${user.id}`);
  await releaseLock(`voice:${user.id}`);
  await ctx.reply(t(ctx, "Отменил. Расскажи новый момент когда захочется.", "Canceled. Tell me a new moment whenever you want."));
}

// Skip a single follow-up question.
export async function skipQuestion(ctx: Context, questionId: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const q = await prisma.clarificationQuestion.findFirst({
    where: { id: questionId, entry: { userId: user.id } },
    include: { entry: true }
  });
  if (!q) return;
  await prisma.clarificationQuestion.update({
    where: { id: q.id },
    data: { answer: "", answeredAt: new Date() }
  });
  const remaining = await prisma.clarificationQuestion.count({
    where: { entryId: q.entryId, answer: null }
  });
  if (remaining > 0) {
    await postNextQuestion(ctx, q.entryId, null);
  } else {
    await prisma.entry.update({ where: { id: q.entryId }, data: { status: EntryStatus.ANSWERS_COLLECTED } });
    await finalizePage(ctx, user, q.entry);
  }
}

// Skip ALL remaining follow-ups for an entry.
export async function skipAllQuestions(ctx: Context, entryId: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const entry = await prisma.entry.findFirst({ where: { id: entryId, userId: user.id } });
  if (!entry) return;
  await prisma.clarificationQuestion.updateMany({
    where: { entryId, answer: null },
    data: { answer: "", answeredAt: new Date() }
  });
  await prisma.entry.update({ where: { id: entryId }, data: { status: EntryStatus.ANSWERS_COLLECTED } });
  await finalizePage(ctx, user, entry);
}

// ── public entry-points ────────────────────────────────────────────────────

export async function handleWeeklyText(ctx: Context, text: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);

  const acceptable: UserState[] = [
    UserState.NEW_USER,
    UserState.READY,
    UserState.WAITING_FOR_WEEKLY_INPUT,
    UserState.CHAPTER_SAVED
  ];
  if (!acceptable.includes(user.state)) {
    await ctx.reply(
      t(
        ctx,
        "Сейчас я в середине другой записи. Нажми /new чтобы начать заново или /cancel чтобы выйти.",
        "I'm in the middle of another entry. Tap /new to restart or /cancel to exit."
      )
    );
    return;
  }

  if (text.trim().length < 20) {
    await ctx.reply(
      t(
        ctx,
        "Слишком коротко. Добавь пару деталей: что произошло, кто был рядом, что хочется запомнить.",
        "Too short. Add a few details: what happened, who was there, what you want to keep."
      )
    );
    return;
  }

  if (!(await preflightCheck(ctx, user))) return;

  const lockKey = `entry:${user.id}`;
  if (!(await acquireLock(lockKey, ENTRY_LOCK_TTL_MS))) {
    await ctx.reply(t(ctx, "Я ещё дописываю предыдущую страницу. Минуту — и эту тоже добавлю.", "Still finishing the previous page — one minute and I'll handle this one too."));
    return;
  }

  track("text_entry_received", { userId: user.id, length: text.length });

  const entry = await prisma.entry.create({
    data: {
      userId: user.id,
      rawText: text,
      status: EntryStatus.COLLECTED,
      periodEnd: new Date(),
      periodStart: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    }
  });

  const status = await openStatus(ctx, entry.id, "thinking");

  // Follow-up questions branch.
  if (config.FOLLOWUP_QUESTIONS_ENABLED && user.followupEnabled !== false) {
    const generated = await generateAndStoreQuestions({ ctx, status, entry, user }, text);
    if (generated > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { state: UserState.WAITING_FOR_ANSWERS } });
      await postNextQuestion(ctx, entry.id, status);
      // Lock stays held; finalizePage releases it.
      return;
    }
  }

  await updateStatus(ctx, status, "writing");
  await finalizePage(ctx, user, entry).finally(async () => {
    await closeStatus(ctx, status);
  });
}

export async function handleVoiceMessage(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const voice = ctx.message?.voice;
  if (!voice) return;

  if (!(await preflightCheck(ctx, user))) return;

  const lockKey = `voice:${user.id}`;
  if (!(await acquireLock(lockKey, ENTRY_LOCK_TTL_MS))) {
    await ctx.reply(t(ctx, "Я ещё дослушиваю предыдущее голосовое. Минуту.", "Still finishing the previous voice. One minute."));
    return;
  }

  track("voice_entry_received", { userId: user.id, duration: voice.duration });
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.TRANSCRIBING_AUDIO } });

  // Create entry record up-front so we have an id for the cancel button.
  const entry = await prisma.entry.create({
    data: {
      userId: user.id,
      telegramVoiceId: voice.file_id,
      status: EntryStatus.COLLECTED,
      periodEnd: new Date(),
      periodStart: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    }
  });

  const status = await openStatus(ctx, entry.id, "listening");

  try {
    const downloaded = await downloadTelegramFile(ctx, voice.file_id);
    const transcript = await transcribeAudio(downloaded.filePath);

    const updatedEntry = await prisma.entry.update({
      where: { id: entry.id },
      data: {
        audioUrl: downloaded.publicPath,
        transcript: transcript.transcript
      }
    });
    track("voice_transcribed", { userId: user.id, entryId: entry.id });

    // Sprint 0.5 — pause and ask the user to confirm what we heard. We tear down
    // the typing/status indicator now: the user is back in control until they
    // confirm or correct. The lock stays held so a second voice can't race in.
    await closeStatus(ctx, status);
    await presentTranscriptForConfirmation(ctx, updatedEntry);
    return;
  } catch (error) {
    if (status) clearInterval(status.refreshTimer);
    await replyWithFriendlyError(ctx, error);
    await releaseLock(lockKey);
  }
}

// Sprint 0.5 — entry point used by transcriptConfirmation.ts after the user
// confirms (or corrects) the transcript. Resumes the normal questions/finalize
// pipeline starting from a confirmed Entry.
//
// We re-fetch the user inside this function (callers usually have a stale copy)
// and run the same logic that used to live inline at the end of handleVoiceMessage.
export async function proceedFromConfirmedEntry(
  ctx: Context,
  entry: Entry,
  user: Awaited<ReturnType<typeof ensureTelegramUser>>
): Promise<void> {
  const sourceText = (entry.finalInputText ?? entry.transcript ?? entry.rawText ?? "").trim();
  if (!sourceText) {
    await ctx.reply(t(ctx, "Не нашёл текста для страницы.", "Couldn't find any text for the page."));
    await releaseLock(`voice:${user.id}`);
    await releaseLock(`entry:${user.id}`);
    return;
  }

  const status = await openStatus(ctx, entry.id, "thinking");

  if (config.FOLLOWUP_QUESTIONS_ENABLED && user.followupEnabled !== false) {
    const generated = await generateAndStoreQuestions({ ctx, status, entry, user }, sourceText);
    if (generated > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { state: UserState.WAITING_FOR_ANSWERS } });
      await postNextQuestion(ctx, entry.id, status);
      // Lock stays held; finalizePage releases it.
      return;
    }
  }

  await updateStatus(ctx, status, "writing");
  await finalizePage(ctx, user, entry).finally(async () => {
    await closeStatus(ctx, status);
  });
}

// Convenience for `/new` command — sends the same prompt the reminder uses.
export async function promptForNewEntry(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  if (!canCreateEntry(user)) {
    await chargePaywall(ctx, user.freeEntriesUsed);
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.WAITING_FOR_WEEKLY_INPUT } });
  await ctx.reply(
    t(ctx, "Какой момент сохраним?\n\nГолосом — быстрее всего.", "Which moment should we keep?\n\nVoice is fastest."),
    { reply_markup: mainMenuKeyboard(ctx) }
  );
}

export { FREE_ENTRY_LIMIT };
