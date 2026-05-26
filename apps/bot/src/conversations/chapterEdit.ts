import type { Context } from "grammy";
import { UserState } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { t, isEnglish } from "../lib/i18n.js";
import { setPending, getPending, clearPending } from "../lib/pending.js";
import { ensureTelegramUser } from "../services/userService.js";
import {
  addDetailToChapterIntro,
  renameChapter,
  resplitChapter
} from "../services/chapterService.js";
import { mainMenuKeyboard } from "../keyboards/mainMenu.js";
import { enqueueChapterSynth } from "../queues/index.js";

// Sprint 4.5 — Chapter edit conversations.
//
// Triggered from the chapter card's inline keyboard:
//   chapter:rename:<id>             → ask for new title → renameChapter
//   chapter:resplit:<id>            → confirm-and-resplit (no text input)
//   chapter:add_intro_detail:<id>   → ask for detail → addDetailToChapterIntro
//
// Pending bucket keys (in lib/pending.ts):
//   chapter_rename:<id>
//   chapter_intro_detail:<id>

const PENDING_RENAME = "chapter_rename:";
const PENDING_INTRO_DETAIL = "chapter_intro_detail:";

async function loadChapter(ctx: Context, chapterId: string) {
  const user = await ensureTelegramUser(ctx);
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, userId: user.id },
    select: { id: true, userId: true, title: true, status: true }
  });
  return { user, chapter };
}

// ── rename ────────────────────────────────────────────────────────────────
export async function startChapterRename(ctx: Context, chapterId: string): Promise<void> {
  const { user, chapter } = await loadChapter(ctx, chapterId);
  if (!chapter) {
    await ctx.reply(t(ctx, "Эту главу я уже не вижу.", "I no longer have that chapter."));
    return;
  }
  await setPending(user.id, `${PENDING_RENAME}${chapter.id}`);
  await prisma.user.update({
    where: { id: user.id },
    data: { state: UserState.AWAITING_CHAPTER_RENAME }
  });
  await ctx.reply(
    t(
      ctx,
      `Какое название дать этой главе вместо «${chapter.title}»? Пришли в одном сообщении.`,
      `What title should this chapter have instead of "${chapter.title}"? Send it in one message.`
    )
  );
}

// ── add detail to intro ───────────────────────────────────────────────────
export async function startChapterIntroDetail(ctx: Context, chapterId: string): Promise<void> {
  const { user, chapter } = await loadChapter(ctx, chapterId);
  if (!chapter) {
    await ctx.reply(t(ctx, "Эту главу я уже не вижу.", "I no longer have that chapter."));
    return;
  }
  await setPending(user.id, `${PENDING_INTRO_DETAIL}${chapter.id}`);
  await prisma.user.update({
    where: { id: user.id },
    data: { state: UserState.AWAITING_CHAPTER_INTRO_DETAIL }
  });
  await ctx.reply(
    t(
      ctx,
      `Что добавить во вступление главы «${chapter.title}»? Пришли деталь, нюанс или контекст — я переделаю только intro, страницы не трону.`,
      `What detail should the intro of "${chapter.title}" reflect? Send a sentence or two — I'll rewrite only the intro, the pages stay.`
    )
  );
}

// ── resplit (no text input) ──────────────────────────────────────────────
export async function handleChapterResplit(ctx: Context, chapterId: string): Promise<void> {
  const { user, chapter } = await loadChapter(ctx, chapterId);
  if (!chapter) {
    await ctx.reply(t(ctx, "Эту главу я уже не вижу.", "I no longer have that chapter."));
    return;
  }
  if (chapter.status !== "DRAFT") {
    await ctx.reply(
      t(
        ctx,
        "Эта глава уже подтверждена — я не могу её просто разбить заново.",
        "This chapter is already approved — I can't silently resplit it."
      )
    );
    return;
  }
  const ok = await resplitChapter(user.id, chapter.id);
  if (!ok) {
    await ctx.reply(t(ctx, "Не получилось разбить заново.", "Couldn't resplit."));
    return;
  }
  await ctx.reply(
    t(
      ctx,
      "Хорошо. Страницы вернулись в общую кучу. Я попробую сложить главу иначе на следующей неделе.",
      "Got it. The pages went back to the unchaptered pool. I'll try a different grouping next week."
    )
  );
  // Kick the synth queue immediately so the alternative grouping appears soon
  // (still gated on CHAPTER_MIN_PAGES).
  await enqueueChapterSynth({ userId: user.id }).catch(() => {});
}

// ── text-router entry point: applies a pending rename or intro-detail ─────
export async function applyChapterEditFromText(ctx: Context, text: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const pending = await getPending(user.id);
  if (!pending) {
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    return;
  }

  const isRename = pending.startsWith(PENDING_RENAME);
  const isIntroDetail = pending.startsWith(PENDING_INTRO_DETAIL);
  const chapterId = isRename
    ? pending.slice(PENDING_RENAME.length)
    : isIntroDetail
      ? pending.slice(PENDING_INTRO_DETAIL.length)
      : null;
  if (!chapterId) {
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    await clearPending(user.id);
    return;
  }

  await ctx.reply(
    t(
      ctx,
      isRename ? "Меняю название…" : "Переписываю intro…",
      isRename ? "Renaming…" : "Reworking the intro…"
    )
  );

  try {
    if (isRename) {
      const updated = await renameChapter(user.id, chapterId, text);
      if (updated) {
        await ctx.reply(
          t(
            ctx,
            `Готово. Глава теперь называется «${updated.title}».`,
            `Done. The chapter is now "${updated.title}".`
          )
        );
      } else {
        await ctx.reply(t(ctx, "Не получилось переименовать.", "Couldn't rename."));
      }
    } else if (isIntroDetail) {
      const updated = await addDetailToChapterIntro(
        user.id,
        chapterId,
        text,
        isEnglish(ctx) ? "en" : "ru"
      );
      if (updated) {
        await ctx.reply(
          t(
            ctx,
            "Готово. Деталь учтена в intro главы.",
            "Done. The detail is reflected in the chapter intro."
          )
        );
      } else {
        await ctx.reply(t(ctx, "Не получилось обновить.", "Couldn't update."));
      }
    }
  } catch (err) {
    logger.warn(
      { err: { message: (err as Error).message }, userId: user.id, chapterId, mode: isRename ? "rename" : "intro_detail" },
      "chapter edit failed"
    );
    await ctx.reply(t(ctx, "Не получилось. Попробуй ещё раз через минуту.", "Didn't work. Try again in a minute."));
  } finally {
    await clearPending(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    await ctx.reply(t(ctx, "Что дальше?", "What's next?"), {
      reply_markup: mainMenuKeyboard(ctx)
    });
  }
}
