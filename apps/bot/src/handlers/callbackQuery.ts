import { UserState } from "@prisma/client";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { sendBook } from "../commands/book.js";
import { sendNewChapterPrompt } from "../commands/new.js";
import { sendSettings } from "../commands/settings.js";
import { sendStart } from "../commands/start.js";
import { ADJUSTMENT_BY_CODE } from "../keyboards/chapterActions.js";
import { confirmDeleteKeyboard } from "../keyboards/settings.js";
import { frequencyKeyboard, styleKeyboard } from "../keyboards/onboarding.js";
import {
  beginOnboarding,
  chooseFrequency,
  chooseGoal,
  chooseReminderDay,
  chooseReminderTime,
  chooseStyle,
  finishOnboarding
} from "../conversations/onboarding.js";
import { generateChapterForEntry, generateQuestionsForEntry } from "../conversations/weeklyEntry.js";
import { adjustReviewedChapter, saveReviewedChapter } from "../conversations/chapterReview.js";
import { deleteLatestSavedChapter } from "../services/chapterService.js";
import { ensureTelegramUser } from "../services/userService.js";
import { getLatestSavedChapter } from "../services/bookService.js";
import { chapterPreviewUrl } from "../services/storage.js";
import { prisma } from "../lib/db.js";
import { track } from "../services/analytics.js";
import { isTelegramInlineUrl } from "../services/urls.js";
import { config } from "../config.js";

export async function handleCallbackQuery(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return;
  }

  await ctx.answerCallbackQuery();

  if (data === "start:onboarding") {
    await beginOnboarding(ctx);
    return;
  }

  if (data === "start:example") {
    await sendExample(ctx);
    return;
  }

  if (data === "start:how") {
    await ctx.reply(
      [
        "Ты отправляешь текст или голосовое о неделе.",
        "",
        "Я задаю 2–4 конкретных вопроса, чтобы не потерять живые детали, а потом превращаю это в главу личной книги.",
        "",
        "Можно сохранить главу, переделать стиль или открыть её как страницу книги."
      ].join("\n")
    );
    return;
  }

  if (data === "nav:start") {
    await sendStart(ctx);
    return;
  }

  if (data === "menu:new") {
    await sendNewChapterPrompt(ctx);
    return;
  }

  if (data === "menu:book") {
    await sendBook(ctx);
    return;
  }

  if (data === "menu:settings") {
    await sendSettings(ctx);
    return;
  }

  if (data === "menu:export") {
    await ctx.reply("PDF-экспорт заложен в архитектуру. В MVP можно открывать главы как красивые страницы книги; полный PDF включается следующим этапом.");
    return;
  }

  if (data === "entry:prompts") {
    await ctx.reply(
      [
        "Можешь ответить на любые из этих вопросов:",
        "",
        "1. Что было главным событием недели?",
        "2. Кто был рядом?",
        "3. Что тебя порадовало?",
        "4. Что было трудно?",
        "5. Какой момент ты хочешь запомнить?",
        "6. Что изменилось в тебе или вокруг тебя?"
      ].join("\n")
    );
    return;
  }

  if (data === "entry:skip") {
    const user = await ensureTelegramUser(ctx);
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    await ctx.reply("Хорошо. Эту неделю пропускаем без чувства долга. Вернёшься, когда будет что сохранить.");
    return;
  }

  if (data.startsWith("onb:goal:")) {
    await chooseGoal(ctx, data.slice("onb:goal:".length));
    return;
  }

  if (data.startsWith("onb:style:")) {
    await chooseStyle(ctx, data.slice("onb:style:".length));
    return;
  }

  if (data.startsWith("onb:freq:")) {
    await chooseFrequency(ctx, data.slice("onb:freq:".length));
    return;
  }

  if (data.startsWith("onb:day:")) {
    await chooseReminderDay(ctx, data.slice("onb:day:".length));
    return;
  }

  if (data.startsWith("onb:time:")) {
    await chooseReminderTime(ctx, data.slice("onb:time:".length));
    return;
  }

  if (data === "onb:privacy_ok") {
    await finishOnboarding(ctx);
    return;
  }

  if (data.startsWith("q:skip:") || data.startsWith("q:gen:")) {
    const entryId = data.startsWith("q:skip:") ? data.slice("q:skip:".length) : data.slice("q:gen:".length);
    await generateChapterForEntry(ctx, entryId);
    return;
  }

  if (data.startsWith("voice:go:")) {
    await generateQuestionsForEntry(ctx, data.slice("voice:go:".length));
    return;
  }

  if (data.startsWith("voice:add:")) {
    const user = await ensureTelegramUser(ctx);
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.WAITING_FOR_WEEKLY_INPUT } });
    await ctx.reply("Хорошо. Отправь ещё текстом или голосом, я добавлю это к новой главе.");
    return;
  }

  if (data.startsWith("voice:cancel:")) {
    const user = await ensureTelegramUser(ctx);
    await prisma.entry.updateMany({ where: { id: data.slice("voice:cancel:".length), userId: user.id }, data: { status: "ARCHIVED" } });
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    await ctx.reply("Отменил. Запись не попадёт в книгу.");
    return;
  }

  if (data.startsWith("ch:save:")) {
    await saveReviewedChapter(ctx, data.slice("ch:save:".length));
    return;
  }

  if (data.startsWith("ch:adj:")) {
    const parts = data.split(":");
    const code = parts[2] as keyof typeof ADJUSTMENT_BY_CODE | undefined;
    const chapterId = parts[3];
    const adjustment = code ? ADJUSTMENT_BY_CODE[code] : undefined;

    if (!adjustment || !chapterId) {
      await ctx.reply("Не понял, какую правку применить. Попробуй нажать кнопку ещё раз.");
      return;
    }

    await adjustReviewedChapter(ctx, adjustment, chapterId);
    return;
  }

  if (data.startsWith("preview:chapter:")) {
    const user = await ensureTelegramUser(ctx);
    const chapterId = data.slice("preview:chapter:".length);
    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, userId: user.id },
      select: { shareToken: true }
    });

    if (!chapter?.shareToken) {
      await ctx.reply("Ссылка на страницу главы пока не готова.");
      return;
    }

    await sendPreviewLink(ctx, chapterPreviewUrl(chapter.shareToken));
    return;
  }

  if (data.startsWith("preview:book:")) {
    const user = await ensureTelegramUser(ctx);
    const bookId = data.slice("preview:book:".length);
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId: user.id },
      select: { id: true }
    });

    if (!book) {
      await ctx.reply("Не нашёл эту книгу.");
      return;
    }

    await sendPreviewLink(ctx, `${config.PUBLIC_WEB_URL.replace(/\/$/, "")}/book/${book.id}`);
    return;
  }

  if (data === "book:last") {
    const user = await ensureTelegramUser(ctx);
    const latest = await getLatestSavedChapter(user.id);
    if (!latest) {
      await ctx.reply("В книге пока нет сохранённых глав.");
      return;
    }
    const previewUrl = latest.shareToken ? chapterPreviewUrl(latest.shareToken) : undefined;
    const keyboard = previewUrl
      ? isTelegramInlineUrl(previewUrl)
        ? new InlineKeyboard().url("Открыть как страницу книги", previewUrl)
        : new InlineKeyboard().text("Открыть как страницу книги", `preview:chapter:${latest.id}`)
      : undefined;
    const message = [`Глава: ${latest.title}`, "", latest.quote ? `“${latest.quote}”` : "", "", latest.content].join("\n");
    if (keyboard) {
      await ctx.reply(message, { reply_markup: keyboard });
    } else {
      await ctx.reply(message);
    }
    return;
  }

  if (data === "set:style") {
    const user = await ensureTelegramUser(ctx);
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.ONBOARDING_STYLE } });
    await ctx.reply("Выбери новый стиль книги.", { reply_markup: styleKeyboard() });
    return;
  }

  if (data === "set:reminders") {
    const user = await ensureTelegramUser(ctx);
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.ONBOARDING_FREQUENCY } });
    await ctx.reply("Как часто напоминать тебе написать новую главу?", { reply_markup: frequencyKeyboard() });
    return;
  }

  if (data === "set:privacy") {
    await ctx.reply("Главы приватны по умолчанию. Публичной становится только ссылка с длинным приватным токеном, если ты сам её отправишь.");
    return;
  }

  if (data === "set:delete_last") {
    await ctx.reply("Удалить последнюю сохранённую главу? Это действие нельзя отменить.", { reply_markup: confirmDeleteKeyboard() });
    return;
  }

  if (data === "delete:last:no") {
    await ctx.reply("Оставил всё как есть.");
    return;
  }

  if (data === "delete:last:yes") {
    const user = await ensureTelegramUser(ctx);
    const deleted = await deleteLatestSavedChapter(user.id);
    await ctx.reply(deleted ? `Удалил главу “${deleted.title}”.` : "Сохранённых глав пока нет.");
    return;
  }

  if (data === "pay:unlock") {
    await startPayment(ctx);
    return;
  }

  await ctx.reply("Эта кнопка устарела. Открой главное меню через /start.");
}

async function sendPreviewLink(ctx: Context, previewUrl: string): Promise<void> {
  if (isTelegramInlineUrl(previewUrl)) {
    await ctx.reply(`Страница книги: ${previewUrl}`);
    return;
  }

  await ctx.reply(
    [
      "Это локальная ссылка для разработки.",
      "",
      previewUrl,
      "",
      "Telegram не открывает localhost в inline-кнопках. Открой ссылку в браузере на этом же компьютере или поставь PUBLIC_WEB_URL на публичный https URL через ngrok/Cloudflare Tunnel."
    ].join("\n")
  );
}

async function sendExample(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      "Вот как это работает.",
      "",
      "Ты пишешь:",
      "“Неделя была странная. Много работал, устал. В пятницу поговорил с мамой, стало легче. В субботу понял, что хочу запустить свой проект.”",
      "",
      "Я превращаю это в главу:",
      "",
      "Глава 1. Неделя, когда я начал слышать себя",
      "",
      "Эта неделя не выглядела как начало чего-то важного. Скорее наоборот — она была уставшей, немного размытой, полной обычных задач и коротких пауз между ними..."
    ].join("\n")
  );
}

async function startPayment(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  track("payment_started", { userId: user.id });

  await prisma.payment.create({
    data: {
      userId: user.id,
      currency: "XTR",
      amount: 500,
      productCode: "lifebook_pro_month",
      status: "PENDING"
    }
  });

  if (!ctx.chat) {
    return;
  }

  await ctx.api.sendInvoice(ctx.chat.id, "LifeBook Pro", "Безлимитные главы, голосовые, память, карточки и PDF-экспорт.", `pro:${user.id}:${Date.now()}`, "XTR", [
    { label: "LifeBook Pro", amount: 500 }
  ]);
}
