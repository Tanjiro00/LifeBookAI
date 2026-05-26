import type { Context } from "grammy";
import { Api, InlineKeyboard, InputFile } from "grammy";
import type { Page, Chapter } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { isEnglish, t } from "../lib/i18n.js";
import { track } from "./analytics.js";
import { config } from "../config.js";
import {
  bookMiniAppUrl,
  chapterMiniAppUrl,
  isTelegramInlineUrl,
  pageMiniAppUrl
} from "./urls.js";
import { renderPosterCardPng, renderChapterCardPng } from "@lifebook/renderer";

// Sprint 0.2 — pageDeliveryService.
//
// One module owns the contract «what shows up in Telegram when a Page or Chapter
// is ready». The contract is now strict:
//
//   WEEKLY page  → ONE sendPhoto(posterCard, caption=teaser) + 4 inline buttons.
//                  No sendMessage(body). Full text lives only in Mini App.
//   PROLOGUE     → same shape, label «Пролог · n из total».
//   CHAPTER      → ONE sendPhoto(chapterCard, caption=biographerNote≤1024) +
//                  4 inline buttons (sprint 4 — chapter renderer lands later;
//                  this file already exposes deliverChapter so callers compile).
//
// Anything that historically dual-sent the body as text in chat is removed.
// The poster-card PNG is deliberately a *poster*, not a substitute for reading.

const POSTER_FALLBACK_TEASER_CHARS = 240;

// Pull a teaser from the body if the model didn't author one. Same shape as the
// mock fallback, kept here so the runtime never has to render a card with no
// teaser.
function deriveTeaser(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const sentences = flat.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").trim();
  const out = sentences || flat;
  return out.length > POSTER_FALLBACK_TEASER_CHARS
    ? out.slice(0, POSTER_FALLBACK_TEASER_CHARS).replace(/\s+\S*$/, "") + "…"
    : out;
}

function pageNumberLabel(ctx: Context, kind: Page["kind"], n: number, total: number): string {
  if (kind === "PROLOGUE") {
    return t(ctx, `Пролог · ${n} из ${total}`, `Prologue · ${n} of ${total}`);
  }
  return t(ctx, `Страница ${n} из ${total}`, `Page ${n} of ${total}`);
}

async function pageNumberFor(page: Pick<Page, "id" | "userId" | "kind" | "createdAt">): Promise<number> {
  // Count pages of the same kind (WEEKLY or PROLOGUE), excluding superseded
  // versions so revisions don't bump the displayed number.
  const cnt = await prisma.page.count({
    where: {
      userId: page.userId,
      kind: page.kind,
      isCurrent: true,
      createdAt: { lte: page.createdAt }
    }
  });
  // If the caller hasn't yet committed isCurrent on this page (rare), at least
  // include this row.
  return Math.max(cnt, 1);
}

// Helper: pick the right kind of "open in book" inline button.
// Telegram has THREE button kinds that look identical to the user but behave
// very differently:
//   - kb.webApp(text, url) — opens URL inside Telegram with the Mini App SDK
//                            attached. Crucially, the JS in the page sees
//                            `window.Telegram.WebApp.initData` so our auth
//                            (POST /api/auth/telegram) succeeds. Requires HTTPS.
//   - kb.url(text, url)    — opens URL in the user's browser. NO Telegram
//                            context → no initData → /api/* returns 401.
//   - kb.text(text, data)  — fires a callback we can handle in-bot. Used as
//                            a fallback when the URL is not HTTPS-eligible
//                            (local dev, private IPs, http://).
//
// We use `webApp` whenever the URL is HTTPS *and* a public hostname, falling
// back to a plain callback otherwise. Plain http://109.107.190.107:3000 in
// dev hits the callback path, which the bot answers with a friendly hint.
function openButtonStrategy(url: string): "webApp" | "callback" {
  return url.startsWith("https://") && isTelegramInlineUrl(url) ? "webApp" : "callback";
}

function deliveryKeyboard(ctx: Context, page: Page): InlineKeyboard {
  const kb = new InlineKeyboard();
  const url = pageMiniAppUrl(page.id);
  if (openButtonStrategy(url) === "webApp") {
    kb.webApp(t(ctx, "📖 Открыть страницу", "📖 Open page"), url).row();
  } else {
    kb.text(t(ctx, "📖 Открыть страницу", "📖 Open page"), `page:open:${page.id}`).row();
  }
  kb.text(t(ctx, "✍️ Подправить", "✍️ Revise"), `page:revise:${page.id}`)
    .text(t(ctx, "🏷 Заголовок", "🏷 Title"), `page:retitle:${page.id}`)
    .row()
    .text(t(ctx, "📌 Что я запомнил", "📌 What I remembered"), `page:memories:${page.id}`);
  return kb;
}

export type DeliverWeeklyOptions = {
  // When true, this delivery is a re-emission after a revision; the caption gets
  // a small «обновлено» prefix so the user can tell which version they're reading.
  isRevision?: boolean;
};

// ── PAGE DELIVERY ───────────────────────────────────────────────────────────

export async function deliverWeeklyPage(
  ctx: Context,
  page: Page,
  options: DeliverWeeklyOptions = {}
): Promise<void> {
  const teaser = page.teaser?.trim() || deriveTeaser(page.sceneContent);
  const pageNumber = await pageNumberFor(page);
  const totalSlots = 52;

  // Render the poster card. Body text is deliberately not rendered on the card.
  const png = renderPosterCardPng({
    pageNumber,
    totalSlots,
    title: page.sceneTitle,
    teaser,
    quote: page.quote,
    mood: page.mood,
    tags: page.tags,
    createdAt: page.createdAt
  });

  // Caption strategy: title + page-number stamp + (optional) revision flag. We do
  // NOT put the body or the teaser in the caption — the teaser is already on the
  // poster image. Caption is just the verbal hook.
  const numberLine = pageNumberLabel(ctx, page.kind, pageNumber, totalSlots);
  const captionLines = [page.sceneTitle, numberLine];
  if (options.isRevision) {
    captionLines.push(
      t(
        ctx,
        "✍️ Обновлено — это новая версия страницы.",
        "✍️ Updated — this is a new version of the page."
      )
    );
  }
  // Caption fits within Telegram's media-caption limit; with 3 short lines we
  // are well under the 1024 cap so no truncation needed.
  const caption = captionLines.join("\n").slice(0, config.TELEGRAM_CAPTION_MAX);

  try {
    await ctx.replyWithPhoto(new InputFile(png, `lifebook-page-${page.id}.png`), {
      caption,
      reply_markup: deliveryKeyboard(ctx, page)
    });
  } catch (error) {
    // A render or upload failure must not lose the work. We log and tell the user
    // the page is in their book; they can read the full text in the Mini App.
    logger.warn(
      { err: { message: (error as Error).message }, pageId: page.id },
      "Poster-card delivery failed"
    );
    const url = pageMiniAppUrl(page.id);
    const fallback = isTelegramInlineUrl(url)
      ? t(
          ctx,
          `Страница готова: ${page.sceneTitle}\n\nПрочитать в книге: ${url}`,
          `Page is ready: ${page.sceneTitle}\n\nRead it in your book: ${url}`
        )
      : t(
          ctx,
          `Страница готова: ${page.sceneTitle}\n\nОткрой /book чтобы прочитать полностью.`,
          `Page is ready: ${page.sceneTitle}\n\nOpen /book to read it fully.`
        );
    await ctx.reply(fallback);
  }

  // Persist that we delivered card-only — used downstream for retention metrics
  // and to detect users who never open the Mini App.
  track("page_delivered_card_only", {
    userId: page.userId,
    pageId: page.id,
    kind: page.kind,
    pageNumber,
    isRevision: Boolean(options.isRevision)
  });
}

// ── CHAPTER DELIVERY ────────────────────────────────────────────────────────
//
// The chapter renderer (renderChapterCardPng) lands in Sprint 4. We expose the
// function here now so callers (Sprint 4's chapterService) wire up to the same
// delivery contract, and so the contract — «one photo, ≤1024 chars caption,
// 4 buttons, never any other message» — lives in one place.

export type ChapterDeliveryInput = {
  chapter: Pick<
    Chapter,
    "id" | "userId" | "title" | "subtitle" | "themes" | "mood" | "tags" | "periodStart" | "periodEnd"
  > & { orderIndex?: number };
  // The biographer's note is what the user reads under the chapter cover. The
  // full chapter intro and pages live in the Mini App.
  biographerNote: string;
  pageIds: string[];
  // Optional book share token — the «Открыть главу» button falls back to the
  // book link when MINIAPP_URL is unset (local dev).
  bookShareToken?: string | null;
  // 1-based page numbers covered by this chapter (for the card footer).
  pageRange?: { from: number; to: number } | null;
};

// Sprint 4.5 — i18n bound to a "language" string instead of a full Context.
// Used by the low-level deliverChapterByApi which is invoked from a worker
// where there's no grammY Context at hand.
type Lang = "ru" | "en";
function tl(lang: Lang, ru: string, en: string): string {
  return lang === "en" ? en : ru;
}

function chapterKeyboardLang(lang: Lang, input: ChapterDeliveryInput): InlineKeyboard {
  const kb = new InlineKeyboard();
  const chapterUrl = chapterMiniAppUrl(input.chapter.id);
  const bookUrl = input.bookShareToken ? bookMiniAppUrl(input.bookShareToken) : chapterUrl;
  const primary = isTelegramInlineUrl(chapterUrl) ? chapterUrl : bookUrl;

  // Same Mini App-vs-callback strategy as deliveryKeyboard above. webApp gives
  // the chapter view access to Telegram.WebApp.initData → JWT auth works.
  if (openButtonStrategy(primary) === "webApp") {
    kb.webApp(tl(lang, "📖 Открыть главу", "📖 Open chapter"), primary).row();
  } else {
    kb.text(tl(lang, "📖 Открыть главу", "📖 Open chapter"), `chapter:open:${input.chapter.id}`).row();
  }
  kb.text(tl(lang, "✏️ Переименовать", "✏️ Rename"), `chapter:rename:${input.chapter.id}`)
    .text(tl(lang, "🔁 Не нравится", "🔁 Resplit"), `chapter:resplit:${input.chapter.id}`)
    .row()
    .text(
      tl(lang, "➕ Добавить деталь в intro", "➕ Add detail to intro"),
      `chapter:add_intro_detail:${input.chapter.id}`
    );
  return kb;
}

function chapterKeyboard(ctx: Context, input: ChapterDeliveryInput): InlineKeyboard {
  const kb = new InlineKeyboard();
  const chapterUrl = chapterMiniAppUrl(input.chapter.id);
  const bookUrl = input.bookShareToken ? bookMiniAppUrl(input.bookShareToken) : chapterUrl;
  const primary = isTelegramInlineUrl(chapterUrl) ? chapterUrl : bookUrl;

  if (openButtonStrategy(primary) === "webApp") {
    kb.webApp(t(ctx, "📖 Открыть главу", "📖 Open chapter"), primary).row();
  } else {
    kb.text(t(ctx, "📖 Открыть главу", "📖 Open chapter"), `chapter:open:${input.chapter.id}`).row();
  }
  kb.text(t(ctx, "✏️ Переименовать", "✏️ Rename"), `chapter:rename:${input.chapter.id}`)
    .text(t(ctx, "🔁 Не нравится", "🔁 Resplit"), `chapter:resplit:${input.chapter.id}`)
    .row()
    .text(
      t(ctx, "➕ Добавить деталь в intro", "➕ Add detail to intro"),
      `chapter:add_intro_detail:${input.chapter.id}`
    );
  return kb;
}

// Truncate to a sentence boundary <= max chars, then append a tail link to the
// Mini App so the user can finish reading. We never split mid-sentence.
function truncateBiographerNote(text: string, max: number, tail: string): string {
  if (text.length <= max) return text;
  const room = Math.max(40, max - tail.length - 1);
  const slice = text.slice(0, room);
  const lastEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  const cut = lastEnd > 80 ? lastEnd + 1 : slice.length;
  return slice.slice(0, cut).trim() + " " + tail;
}

function buildChapterPng(input: ChapterDeliveryInput, override?: Buffer): Buffer {
  return (
    override ??
    renderChapterCardPng({
      chapterNumber: input.chapter.orderIndex !== undefined ? input.chapter.orderIndex + 1 : 1,
      title: input.chapter.title,
      subtitle: input.chapter.subtitle ?? null,
      themes: input.chapter.themes ?? [],
      pageRange: input.pageRange ?? null,
      periodStart: input.chapter.periodStart ?? null,
      periodEnd: input.chapter.periodEnd ?? null,
      mood: input.chapter.mood ?? [],
      tags: input.chapter.tags ?? []
    })
  );
}

// Low-level chapter delivery used by the chapterSynthJob worker, which doesn't
// have a grammY Context. Takes the bot Api, the chat id, and an explicit
// language. Same delivery contract: ONE photo, caption ≤1024 chars, 4 buttons.
export async function deliverChapterByApi(opts: {
  api: Api;
  chatId: number | string;
  language: Lang;
  input: ChapterDeliveryInput;
  chapterCardPng?: Buffer;
}): Promise<void> {
  const tail = tl(opts.language, "…читать в книге →", "…read in the book →");
  const caption = truncateBiographerNote(opts.input.biographerNote, config.TELEGRAM_CAPTION_MAX, tail);
  const png = buildChapterPng(opts.input, opts.chapterCardPng);

  try {
    await opts.api.sendPhoto(opts.chatId, new InputFile(png, `lifebook-chapter-${opts.input.chapter.id}.png`), {
      caption,
      reply_markup: chapterKeyboardLang(opts.language, opts.input)
    });
  } catch (error) {
    logger.warn(
      { err: { message: (error as Error).message }, chapterId: opts.input.chapter.id },
      "Chapter-card delivery failed (api path)"
    );
    const url = chapterMiniAppUrl(opts.input.chapter.id);
    const fallback = isTelegramInlineUrl(url)
      ? tl(opts.language, `Новая глава: ${opts.input.chapter.title}\n\nОткрой: ${url}`, `New chapter: ${opts.input.chapter.title}\n\nOpen: ${url}`)
      : tl(opts.language, `Новая глава: ${opts.input.chapter.title}\n\nОткрой /book чтобы прочитать.`, `New chapter: ${opts.input.chapter.title}\n\nOpen /book to read it.`);
    await opts.api.sendMessage(opts.chatId, fallback);
  }
  track("chapter_delivered_card_only", {
    userId: opts.input.chapter.userId,
    chapterId: opts.input.chapter.id,
    pageCount: opts.input.pageIds.length
  });
}

// Context-bound delivery used inside grammY handlers (e.g. user tapping a
// button). Internally normalises to deliverChapterByApi — same contract.
export async function deliverChapter(
  ctx: Context,
  input: ChapterDeliveryInput,
  chapterCardPng?: Buffer
): Promise<void> {
  if (!ctx.chat) {
    throw new Error("deliverChapter: ctx has no chat");
  }
  const language: Lang = isEnglish(ctx) ? "en" : "ru";
  await deliverChapterByApi({
    api: ctx.api,
    chatId: ctx.chat.id,
    language,
    input,
    ...(chapterCardPng ? { chapterCardPng } : {})
  });
}

// Re-export helpers used by callers (e.g. chapterEdit conversation in Sprint 4).
export { deriveTeaser as deriveTeaserFromBody, isEnglish };
