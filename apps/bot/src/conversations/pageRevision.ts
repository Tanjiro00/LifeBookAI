import type { Context } from "grammy";
import { UserState } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { t } from "../lib/i18n.js";
import { logger } from "../lib/logger.js";
import { setPending, getPending, clearPending } from "../lib/pending.js";
import { ensureTelegramUser } from "../services/userService.js";
import {
  reviseExistingPage,
  rewritePageTitle
} from "../services/pageRevisionService.js";
import { deliverWeeklyPage } from "../services/pageDeliveryService.js";
import { mainMenuKeyboard } from "../keyboards/mainMenu.js";

// Sprint 2.6/2.7 — Page revision conversation.
//
// Flow:
//   user taps «✍️ Подправить» → bot asks for instruction → user replies →
//   reviseExistingPage creates v+1 → deliverWeeklyPage re-emits the card.
//
// We stash the target pageId in the existing pending-key Redis bucket
// (lib/pending.ts). State machine: AWAITING_PAGE_REVISION; the next text the
// user sends is consumed by applyRevisionFromText.
//
// Same flow for «🏷 Заголовок», routed via a different pending value.

const PENDING_REVISE_PREFIX = "page_revise:";
const PENDING_RETITLE_PREFIX = "page_retitle:";

export async function startPageRevision(ctx: Context, pageId: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  // Verify the page actually belongs to this user before we ask anything.
  const page = await prisma.page.findFirst({
    where: { id: pageId, userId: user.id, isCurrent: true },
    select: { id: true, sceneTitle: true }
  });
  if (!page) {
    await ctx.reply(t(ctx, "Эта страница больше не активна.", "This page is no longer active."));
    return;
  }
  await setPending(user.id, `${PENDING_REVISE_PREFIX}${page.id}`);
  await prisma.user.update({
    where: { id: user.id },
    data: { state: UserState.AWAITING_PAGE_REVISION }
  });
  await ctx.reply(
    t(
      ctx,
      [
        `Что поправить в «${page.sceneTitle}»?`,
        "",
        "Можно так:",
        "  · «замени второй абзац: …»",
        "  · «я был зол, а не грустен»",
        "  · «убери диалог про работу»"
      ].join("\n"),
      [
        `What should I change in "${page.sceneTitle}"?`,
        "",
        "You can write:",
        "  · «replace the second paragraph: …»",
        "  · «I was angry, not sad»",
        "  · «remove the dialogue about work»"
      ].join("\n")
    )
  );
}

export async function startTitleRewrite(ctx: Context, pageId: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const page = await prisma.page.findFirst({
    where: { id: pageId, userId: user.id, isCurrent: true },
    select: { id: true, sceneTitle: true }
  });
  if (!page) {
    await ctx.reply(t(ctx, "Эта страница больше не активна.", "This page is no longer active."));
    return;
  }
  await setPending(user.id, `${PENDING_RETITLE_PREFIX}${page.id}`);
  await prisma.user.update({
    where: { id: user.id },
    data: { state: UserState.AWAITING_PAGE_REVISION }
  });
  await ctx.reply(
    t(
      ctx,
      [
        `Перепишу заголовок «${page.sceneTitle}». Если есть пожелание — пришли его одной фразой; если нет, просто напиши «перепиши».`
      ].join("\n"),
      [
        `I'll rewrite the title "${page.sceneTitle}". Send a hint if you have one, or just write «rewrite».`
      ].join("\n")
    )
  );
}

// Called from textMessage when user.state === AWAITING_PAGE_REVISION.
export async function applyRevisionFromText(ctx: Context, text: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const pending = await getPending(user.id);
  if (!pending) {
    // Stale state — drop into ready and treat the text as a fresh entry.
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    return;
  }

  const isRevise = pending.startsWith(PENDING_REVISE_PREFIX);
  const isRetitle = pending.startsWith(PENDING_RETITLE_PREFIX);
  const pageId = isRevise
    ? pending.slice(PENDING_REVISE_PREFIX.length)
    : isRetitle
      ? pending.slice(PENDING_RETITLE_PREFIX.length)
      : null;
  if (!pageId) {
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    await clearPending(user.id);
    return;
  }

  // Acknowledge so the user knows the bot is on it (revisions take a few seconds).
  await ctx.reply(
    t(
      ctx,
      isRetitle ? "Подбираю заголовок…" : "Перерабатываю страницу…",
      isRetitle ? "Reworking the title…" : "Reworking the page…"
    )
  );

  try {
    const next = isRetitle
      ? await rewritePageTitle({ user, pageId, userInstruction: text })
      : await reviseExistingPage({ user, pageId, userInstruction: text });
    await deliverWeeklyPage(ctx, next, { isRevision: true });
  } catch (err) {
    logger.warn(
      { err: { message: (err as Error).message }, userId: user.id, pageId, mode: isRetitle ? "title" : "body" },
      "page revision failed"
    );
    await ctx.reply(
      t(
        ctx,
        "Не получилось переработать страницу. Попробуй ещё раз через минуту.",
        "Couldn't rework the page. Try again in a minute."
      )
    );
  } finally {
    await clearPending(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    await ctx.reply(t(ctx, "Что дальше?", "What's next?"), {
      reply_markup: mainMenuKeyboard(ctx)
    });
  }
}
