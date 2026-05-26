import type { Context } from "grammy";
import { sendBook } from "../commands/book.js";
import { sendNewChapterPrompt } from "../commands/new.js";
import { sendSettings } from "../commands/settings.js";
import { sendStart } from "../commands/start.js";
import { applyReminderPreset } from "../conversations/onboarding.js";
import { ensureTelegramUser } from "../services/userService.js";
import { bookPreviewUrl } from "../services/storage.js";
import { findProductByCode, isProActive, PRODUCT_CATALOG, paywallText } from "../services/subscriptions.js";
import { paywallKeyboard } from "../keyboards/settings.js";
import { buildBookPdfForUser } from "../services/bookComposer.js";
import { InputFile } from "grammy";
import { prisma } from "../lib/db.js";
import { track } from "../services/analytics.js";
import { logger } from "../lib/logger.js";
import { t } from "../lib/i18n.js";
import { cancelEntry, skipQuestion, skipAllQuestions } from "../conversations/weeklyEntry.js";
import { deleteMemory } from "../services/memoryService.js";
import { setPending } from "../lib/pending.js";
import { sendTitlePrompt } from "../commands/title.js";
import { reminderPresetKeyboard } from "../keyboards/onboarding.js";
import { skipIntakeQuestion, skipAllIntakeQuestions } from "../conversations/onboarding.js";
// Sprint 5.7 — account deletion confirmation callbacks.
import { confirmDeleteAccount, abortDeleteAccount } from "../commands/privacy.js";
// Sprint 0.5 — voice transcript confirmation callbacks.
import {
  TRANSCRIPT_CONFIRM_PREFIX,
  TRANSCRIPT_EDIT_PREFIX,
  handleConfirmTranscript,
  handleRequestTranscriptCorrection
} from "../conversations/transcriptConfirmation.js";
// Sprint 2.6/2.7 — page revision callbacks.
import { startPageRevision, startTitleRewrite } from "../conversations/pageRevision.js";
import { chapterMiniAppUrl, pageMiniAppUrl } from "../services/urls.js";
// Sprint 4.5 — chapter edit conversations.
import {
  handleChapterResplit,
  startChapterIntroDetail,
  startChapterRename
} from "../conversations/chapterEdit.js";

const PROMPT_HINTS_RU = [
  "Что было главным событием этой недели?",
  "Кто был рядом — даже если появился ненадолго?",
  "Какой момент ты хочешь запомнить через 10 лет?",
  "Что-то изменилось в тебе или вокруг — даже на миллиметр?",
  "Какую фразу ты повторял(а) про себя на этой неделе?"
];

const PROMPT_HINTS_EN = [
  "What was the main event of this week?",
  "Who was there with you — even briefly?",
  "Which moment do you want to remember 10 years from now?",
  "What changed in you or around you — even a millimeter?",
  "What phrase did you keep repeating to yourself this week?"
];

export async function handleCallbackQuery(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  await ctx.answerCallbackQuery().catch(() => {});

  // Top-level navigation
  if (data === "nav:start") return void (await sendStart(ctx));
  if (data === "menu:new") return void (await sendNewChapterPrompt(ctx));
  if (data === "menu:book") return void (await sendBook(ctx));
  if (data === "menu:settings") return void (await sendSettings(ctx));

  // Entry cancel mid-generation
  if (data.startsWith("entry:cancel:")) {
    return void (await cancelEntry(ctx, data.slice("entry:cancel:".length)));
  }

  // Sprint 0.5 — voice transcript confirmation. Two callbacks, one per button.
  if (data.startsWith(TRANSCRIPT_CONFIRM_PREFIX)) {
    return void (await handleConfirmTranscript(ctx, data.slice(TRANSCRIPT_CONFIRM_PREFIX.length)));
  }
  if (data.startsWith(TRANSCRIPT_EDIT_PREFIX)) {
    return void (await handleRequestTranscriptCorrection(ctx, data.slice(TRANSCRIPT_EDIT_PREFIX.length)));
  }

  // Sprint 0.1 — page-card buttons. Sprint 2.6/2.7 wires up revise/retitle.
  if (data.startsWith("page:open:")) {
    // Fallback when MINIAPP_URL isn't an https URL Telegram can inline.
    const pageId = data.slice("page:open:".length);
    const url = pageMiniAppUrl(pageId);
    await ctx.reply(t(ctx, `Открой страницу: ${url}`, `Open this page: ${url}`));
    return;
  }
  if (data.startsWith("page:revise:")) {
    return void (await startPageRevision(ctx, data.slice("page:revise:".length)));
  }
  if (data.startsWith("page:retitle:")) {
    return void (await startTitleRewrite(ctx, data.slice("page:retitle:".length)));
  }
  if (data.startsWith("page:memories:")) {
    // Memories per-page view lands in Sprint 3; for Sprint 2 we drop the user
    // into the existing /memories list.
    await ctx.reply(t(ctx, "Открой /memories — там я храню всё, что запомнил.", "Open /memories — that's where I keep what I remembered."));
    return;
  }
  // Sprint 5.7 — account deletion confirm / abort.
  if (data === "account:delete:confirm") {
    return void (await confirmDeleteAccount(ctx));
  }
  if (data === "account:delete:abort") {
    return void (await abortDeleteAccount(ctx));
  }

  // Sprint 4.5 — chapter card buttons. «Открыть» falls back to a URL message
  // when the Mini App link isn't an https URL Telegram can inline (local dev).
  if (data.startsWith("chapter:open:")) {
    const chapterId = data.slice("chapter:open:".length);
    const url = chapterMiniAppUrl(chapterId);
    await ctx.reply(t(ctx, `Открой главу: ${url}`, `Open the chapter: ${url}`));
    return;
  }
  if (data.startsWith("chapter:rename:")) {
    return void (await startChapterRename(ctx, data.slice("chapter:rename:".length)));
  }
  if (data.startsWith("chapter:resplit:")) {
    return void (await handleChapterResplit(ctx, data.slice("chapter:resplit:".length)));
  }
  if (data.startsWith("chapter:add_intro_detail:")) {
    return void (await startChapterIntroDetail(ctx, data.slice("chapter:add_intro_detail:".length)));
  }

  // Follow-up question skip handlers
  if (data.startsWith("q:skip:")) {
    return void (await skipQuestion(ctx, data.slice("q:skip:".length)));
  }
  if (data.startsWith("q:skipall:")) {
    return void (await skipAllQuestions(ctx, data.slice("q:skipall:".length)));
  }

  // Onboarding intake skip handlers
  if (data.startsWith("intake:skip:")) {
    const idx = Number(data.slice("intake:skip:".length));
    return void (await skipIntakeQuestion(ctx, Number.isFinite(idx) ? idx : 0));
  }
  if (data === "intake:skipall") {
    return void (await skipAllIntakeQuestions(ctx));
  }

  // Memory delete
  if (data.startsWith("mem:del:")) {
    const user = await ensureTelegramUser(ctx);
    const memoryId = data.slice("mem:del:".length);
    const ok = await deleteMemory(user.id, memoryId);
    if (ok) track("memory_deleted", { userId: user.id, memoryId });
    await ctx.reply(ok ? t(ctx, "Удалил.", "Deleted.") : t(ctx, "Не нашёл такую память.", "Couldn't find that memory."));
    return;
  }

  // Sprint 3.7 — Memory edit. Two-step: tap «✏» on the «Я запомнил» follow-up
  // or in /memories. Bot asks for the new content; the user's next text replaces
  // the memory's currentSummary and appends a MemoryRevision row.
  if (data.startsWith("mem:edit:")) {
    const user = await ensureTelegramUser(ctx);
    const memoryId = data.slice("mem:edit:".length);
    const memory = await prisma.memory.findFirst({
      where: { id: memoryId, userId: user.id },
      select: { id: true, title: true, type: true }
    });
    if (!memory) {
      await ctx.reply(t(ctx, "Эту память я уже не вижу.", "I no longer have that memory."));
      return;
    }
    track("memory_edit_started", { userId: user.id, memoryId });
    await setPending(user.id, `mem_edit:${memoryId}`);
    await ctx.reply(
      t(
        ctx,
        `Что я должен помнить про «${memory.title}»? Пришли свою формулировку — я заменю содержимое.`,
        `What should I remember about "${memory.title}"? Send your version and I'll replace the content.`
      )
    );
    return;
  }

  // Sprint 3.7 — «не запоминать такое». Mark the row doNotUse=true; the
  // memoryReviewService skips merges into it on future entries.
  if (data.startsWith("mem:nu:")) {
    const user = await ensureTelegramUser(ctx);
    const memoryId = data.slice("mem:nu:".length);
    const updated = await prisma.memory.updateMany({
      where: { id: memoryId, userId: user.id },
      data: { doNotUse: true }
    });
    if (updated.count) track("memory_marked_do_not_use", { userId: user.id, memoryId });
    await ctx.reply(
      t(
        ctx,
        updated.count
          ? "Хорошо. Не буду больше использовать это в книге."
          : "Уже не нашёл такую память.",
        updated.count ? "Got it. I won't use this in the book anymore." : "Couldn't find that memory."
      )
    );
    return;
  }

  // Follow-up toggle in settings
  if (data === "set:followup:on" || data === "set:followup:off") {
    const user = await ensureTelegramUser(ctx);
    const enabled = data.endsWith(":on");
    await prisma.user.update({ where: { id: user.id }, data: { followupEnabled: enabled } });
    await ctx.reply(
      enabled
        ? t(ctx, "Хорошо, буду задавать пару уточняющих вопросов.", "Got it — I'll ask a couple of clarifying questions.")
        : t(ctx, "Хорошо, буду писать страницы сразу.", "Got it — I'll skip questions and write straight away.")
    );
    return;
  }

  // Settings actions
  if (data === "set:title") {
    return void (await sendTitlePrompt(ctx));
  }
  if (data === "set:reminders") {
    await ctx.reply(t(ctx, "Когда напоминать?", "When should I remind?"), { reply_markup: reminderPresetKeyboard(ctx) });
    return;
  }
  if (data === "set:plan") {
    const user = await ensureTelegramUser(ctx);
    if (isProActive(user)) {
      const until = user.proUntil ? user.proUntil.toLocaleDateString(ctx.from?.language_code?.startsWith("en") ? "en-US" : "ru-RU") : "—";
      await ctx.reply(t(ctx, `Pro активен до ${until}.`, `Pro is active until ${until}.`));
      return;
    }
    await ctx.reply(paywallText(ctx, user.freeEntriesUsed), { reply_markup: paywallKeyboard(ctx) });
    return;
  }

  // Weekly prompt buttons
  if (data === "entry:prompts") {
    const hints = ctx.from?.language_code?.toLowerCase().startsWith("en") ? PROMPT_HINTS_EN : PROMPT_HINTS_RU;
    const lines = [t(ctx, "Можно ответить на любой:", "Pick any of these:"), "", ...hints.map((p, i) => `${i + 1}. ${p}`)];
    await ctx.reply(lines.join("\n"));
    return;
  }
  if (data === "entry:skip") {
    const user = await ensureTelegramUser(ctx);
    await prisma.user.update({ where: { id: user.id }, data: { state: "READY" } });
    await ctx.reply(t(ctx, "Хорошо. Эту неделю пропускаем — без чувства долга.", "Okay. Skipping this week — no guilt."));
    return;
  }

  // Reminder preset (used during onboarding and from /settings)
  if (data.startsWith("onb:rmd:")) {
    await applyReminderPreset(ctx, data.slice("onb:rmd:".length));
    return;
  }

  // Open book preview link.
  if (data.startsWith("preview:book:")) {
    const user = await ensureTelegramUser(ctx);
    const bookId = data.slice("preview:book:".length);
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId: user.id },
      select: { shareToken: true }
    });
    if (!book?.shareToken) {
      await ctx.reply(t(ctx, "Книга появится по ссылке, как только сохранишь хотя бы одну запись.", "The book link appears once you've saved at least one entry."));
      return;
    }
    await ctx.reply(bookPreviewUrl(book.shareToken));
    return;
  }

  // Pro purchase — Telegram Stars invoice
  if (data === "pay:month") return void (await startPayment(ctx, "pro_month"));
  if (data === "pay:year")  return void (await startPayment(ctx, "pro_year"));
  if (data === "pay:unlock") return void (await startPayment(ctx, "pro_year"));

  // Pro-gated: build and send the PDF book.
  if (data === "book:pdf") {
    const user = await ensureTelegramUser(ctx);
    if (!isProActive(user)) {
      await ctx.reply(paywallText(ctx, user.freeEntriesUsed), { reply_markup: paywallKeyboard(ctx) });
      return;
    }
    await ctx.reply(t(ctx, "Собираю книгу. Пара секунд.", "Building your book. A few seconds."));
    try {
      const built = await buildBookPdfForUser(user.id);
      if (!built) {
        await ctx.reply(t(ctx, "Пока нечего складывать в книгу. Запиши хотя бы одну страницу.", "Nothing to bind yet. Send at least one entry."));
        return;
      }
      await ctx.replyWithDocument(new InputFile(built.filePath, "lifebook.pdf"));
    } catch (err) {
      logger.warn({ err }, "PDF build failed");
      await ctx.reply(t(ctx, "Не получилось собрать PDF. Попробуй ещё раз через минуту.", "Couldn't build the PDF. Try again in a minute."));
    }
    return;
  }

  if (data === "set:privacy") {
    await ctx.reply(
      t(
        ctx,
        "Все записи приватны. Книга открывается только по твоей ссылке с длинным секретным токеном — никаких списков, никакой публичной ленты.",
        "All entries are private. The book opens only via your link with a long secret token — no public listing, no feed."
      )
    );
    return;
  }

  // Legacy callbacks from prior versions — silently absorb so old buttons don't error.
  if (
    data.startsWith("voice:") ||
    data.startsWith("ch:") ||
    data.startsWith("chap:") ||
    data.startsWith("preview:chapter:") ||
    data.startsWith("preview:page:") ||
    data.startsWith("share:") ||
    data.startsWith("onb:goal:") ||
    data.startsWith("onb:style:") ||
    data.startsWith("onb:freq:") ||
    data.startsWith("onb:day:") ||
    data.startsWith("onb:time:") ||
    data === "onb:privacy_ok" ||
    data === "set:style" ||
    data === "set:delete_last" ||
    data === "delete:last:yes" ||
    data === "delete:last:no" ||
    data === "menu:export" ||
    data === "start:onboarding" ||
    data === "start:example" ||
    data === "start:how"
  ) {
    await ctx.reply(t(ctx, "Просто отправь следующую запись — я допишу страницу.", "Just send your next moment — I'll write the page."));
    return;
  }

  await ctx.reply(t(ctx, "Эта кнопка устарела. /start вернёт в главное меню.", "This button is stale. /start returns to the main menu."));
}

async function startPayment(ctx: Context, key: keyof typeof PRODUCT_CATALOG): Promise<void> {
  const product = PRODUCT_CATALOG[key];
  const user = await ensureTelegramUser(ctx);
  track("payment_started", { userId: user.id, productCode: product.code });

  await prisma.payment.create({
    data: {
      userId: user.id,
      currency: "XTR",
      amount: product.amountStars,
      productCode: product.code,
      status: "PENDING"
    }
  });

  if (!ctx.chat) return;

  if (!findProductByCode(product.code)) {
    await ctx.reply(t(ctx, "Этот тариф пока недоступен. Попробуй позже.", "This plan isn't available right now."));
    return;
  }

  const isEn = ctx.from?.language_code?.toLowerCase().startsWith("en");
  const label = isEn ? product.labelEn : product.label;
  const description = isEn ? product.descriptionEn : product.description;

  const payload = `${product.code}:${user.id}:${Date.now()}`;
  await ctx.api.sendInvoice(
    ctx.chat.id,
    label,
    description,
    payload,
    "XTR",
    [{ label, amount: product.amountStars }]
  );
}
