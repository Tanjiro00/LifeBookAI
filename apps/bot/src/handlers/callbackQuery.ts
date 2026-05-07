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

const PROMPT_HINTS_RU = [
  "Что было главным событием этой недели?",
  "Кто был рядом — даже если появился ненадолго?",
  "Какой момент ты хочешь запомнить через 10 лет?",
  "Что-то изменилось в тебе или вокруг — даже на миллиметр?",
  "Какую фразу ты повторял(а) про себя на этой неделе?"
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

  // Weekly prompt buttons
  if (data === "entry:prompts") {
    const lines = ["Можно ответить на любой:", "", ...PROMPT_HINTS_RU.map((p, i) => `${i + 1}. ${p}`)];
    await ctx.reply(lines.join("\n"));
    return;
  }
  if (data === "entry:skip") {
    const user = await ensureTelegramUser(ctx);
    await prisma.user.update({ where: { id: user.id }, data: { state: "READY" } });
    await ctx.reply("Хорошо. Эту неделю пропускаем — без чувства долга.");
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
      await ctx.reply("Книга появится по ссылке, как только сохранишь хотя бы одну запись.");
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
      await ctx.reply(paywallText(user.freeEntriesUsed), { reply_markup: paywallKeyboard() });
      return;
    }
    await ctx.reply("Собираю книгу. Пара секунд.");
    try {
      const built = await buildBookPdfForUser(user.id);
      if (!built) {
        await ctx.reply("Пока нечего складывать в книгу. Запиши хотя бы одну страницу.");
        return;
      }
      await ctx.replyWithDocument(new InputFile(built.filePath, "lifebook.pdf"));
    } catch (err) {
      logger.warn({ err }, "PDF build failed");
      await ctx.reply("Не получилось собрать PDF. Попробуй ещё раз через минуту.");
    }
    return;
  }

  // Settings — minimum: just reminder presets (handled via onb:rmd above) and /book.
  if (data === "set:privacy") {
    await ctx.reply(
      "Все записи приватны. Книга открывается только по твоей ссылке с длинным секретным токеном — никаких списков, никакой публичной ленты."
    );
    return;
  }

  // Legacy callbacks from prior versions — silently absorb so old buttons don't error.
  if (
    data.startsWith("q:") ||
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
    data === "set:reminders" ||
    data === "set:delete_last" ||
    data === "delete:last:yes" ||
    data === "delete:last:no" ||
    data === "menu:export" ||
    data === "start:onboarding" ||
    data === "start:example" ||
    data === "start:how"
  ) {
    await ctx.reply("Просто отправь мне следующую запись — я допишу страницу.");
    return;
  }

  await ctx.reply("Эта кнопка устарела. /start вернёт в главное меню.");
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
    await ctx.reply("Этот тариф пока недоступен. Попробуй позже.");
    return;
  }

  const payload = `${product.code}:${user.id}:${Date.now()}`;
  await ctx.api.sendInvoice(
    ctx.chat.id,
    product.label,
    product.description,
    payload,
    "XTR",
    [{ label: product.label, amount: product.amountStars }]
  );
}
