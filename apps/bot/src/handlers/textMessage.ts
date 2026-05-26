import type { Context } from "grammy";
import { handleWeeklyText } from "../conversations/weeklyEntry.js";
import { isSensitiveAdviceRequest } from "../lib/errors.js";
import { matchMainMenuLabel } from "../keyboards/mainMenu.js";
import { sendBook } from "../commands/book.js";
import { sendNewChapterPrompt } from "../commands/new.js";
import { sendSettings } from "../commands/settings.js";
import { sendStats } from "../commands/stats.js";
import { handleAnswerForFollowup } from "../conversations/weeklyEntry.js";
import { ensureTelegramUser } from "../services/userService.js";
import { UserState } from "@prisma/client";
import { t } from "../lib/i18n.js";
import { getPending } from "../lib/pending.js";
import { applyTitleFromText } from "../commands/title.js";
import { handleIntakeAnswer } from "../conversations/onboarding.js";
import { applyTranscriptCorrection } from "../conversations/transcriptConfirmation.js";
import { applyRevisionFromText } from "../conversations/pageRevision.js";

export async function handleTextMessage(ctx: Context): Promise<void> {
  const raw = ctx.message?.text;
  const text = raw?.trim();

  // 1. Empty / whitespace-only → respond instead of silently dropping.
  if (raw && !text) {
    await ctx.reply(
      t(
        ctx,
        "Не вижу текста — пришли пару строк или удерживай микрофон.",
        "I don't see any text — send a few lines or hold the mic."
      )
    );
    return;
  }
  if (!text) return;

  // 2. Slash commands handled by command middleware — skip.
  if (text.startsWith("/")) return;

  // 3. Persistent ReplyKeyboard taps come through as plain text. Route to commands.
  const menuAction = matchMainMenuLabel(ctx, text);
  if (menuAction === "new") return void (await sendNewChapterPrompt(ctx));
  if (menuAction === "book") return void (await sendBook(ctx));
  if (menuAction === "stats") return void (await sendStats(ctx));
  if (menuAction === "settings") return void (await sendSettings(ctx));

  // 4a. Pending ephemeral input (e.g. user typing a custom book title).
  const user = await ensureTelegramUser(ctx);
  const pending = await getPending(user.id);
  if (pending === "title") {
    await applyTitleFromText(ctx, text);
    return;
  }

  // 4a.1. Sprint 2.6 — Page revision instruction. Pending key namespaced as
  // `page_revise:<id>` or `page_retitle:<id>`. The conversation handler reads
  // the pending key itself; we just route here.
  if (pending && (pending.startsWith("page_revise:") || pending.startsWith("page_retitle:"))) {
    await applyRevisionFromText(ctx, text);
    return;
  }

  // 4a.2. Sprint 3.7 — Memory edit. User tapped «✏» on a memory; their reply
  // is the new content for that memory.
  if (pending && pending.startsWith("mem_edit:")) {
    const { applyMemoryEditFromText } = await import("../conversations/memoryEdit.js");
    await applyMemoryEditFromText(ctx, text);
    return;
  }

  // 4a.3. Sprint 4.5 — Chapter rename / intro-detail. Pending key namespaced
  // as `chapter_rename:<id>` or `chapter_intro_detail:<id>`.
  if (pending && (pending.startsWith("chapter_rename:") || pending.startsWith("chapter_intro_detail:"))) {
    const { applyChapterEditFromText } = await import("../conversations/chapterEdit.js");
    await applyChapterEditFromText(ctx, text);
    return;
  }

  // 4b. Onboarding intake — text answer to the current biographical question.
  if (user.state === UserState.ONBOARDING_INTAKE) {
    await handleIntakeAnswer(ctx, text);
    return;
  }

  // 4b.1. Voice transcript correction (Sprint 0.5). User has tapped «Поправить»
  // on the transcript prompt and is now sending the corrected version. We treat
  // their text as the canonical entry input, replacing what Whisper produced.
  if (user.state === UserState.AWAITING_TRANSCRIPT_CONFIRM) {
    await applyTranscriptCorrection(ctx, text);
    return;
  }

  // 4b.2. Sprint 2.6 — page revision when state is set but pending bucket cleared
  // (rare race; treat as fallback).
  if (user.state === UserState.AWAITING_PAGE_REVISION) {
    await applyRevisionFromText(ctx, text);
    return;
  }

  // 4c. If the user is mid-followup (waiting for an answer to a clarifying question),
  // treat the next text as that answer rather than as a new entry.
  if (user.state === UserState.WAITING_FOR_ANSWERS) {
    await handleAnswerForFollowup(ctx, text);
    return;
  }

  // 5. Sensitive-advice guard.
  if (isSensitiveAdviceRequest(text) && /что делать|посоветуй|advice|what should/i.test(text)) {
    await ctx.reply(
      t(
        ctx,
        [
          "Я не терапевт и не врач — медицинских или психологических советов не даю.",
          "",
          "Но я могу бережно записать этот период как часть твоей книги: что произошло, кто был рядом, что хочется не потерять."
        ].join("\n"),
        [
          "I'm not a therapist or a doctor — I can't give medical or psychological advice.",
          "",
          "But I can gently record this period as part of your book: what happened, who was there, what you don't want to lose."
        ].join("\n")
      )
    );
    return;
  }

  // 6. Default: treat any text as a weekly entry.
  await handleWeeklyText(ctx, text);
}
