import type { Context } from "grammy";
import { InlineKeyboard, InputFile } from "grammy";
import { join } from "node:path";
import { ensureTelegramUser } from "../services/userService.js";
import { bookPreviewUrl } from "../services/storage.js";
import { isProActive } from "../services/subscriptions.js";
import { track } from "../services/analytics.js";
import { isTelegramInlineUrl } from "../services/urls.js";
import { paths } from "../config.js";
import { prisma } from "../lib/db.js";

const TOTAL_SLOTS = 52;

// /book — single layout regardless of state. Cover (or simple placeholder) + 2 buttons.
export async function sendBook(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  track("book_opened", { userId: user.id });

  const [book, count] = await Promise.all([
    prisma.book.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, aiTitle: true, coverUrl: true, shareToken: true }
    }),
    prisma.page.count({ where: { userId: user.id } })
  ]);

  if (count === 0) {
    await ctx.reply(
      "Книга пока пустая. Расскажи момент — текстом или голосом, я открою первую страницу.",
      { reply_markup: new InlineKeyboard().text("Новая запись", "menu:new") }
    );
    return;
  }

  const title = book?.aiTitle || book?.title || "Книга твоего года";
  const counter = `${count} из ${TOTAL_SLOTS} записей · книга готова к ${shipDate()}`;

  const kb = new InlineKeyboard();
  if (book?.shareToken) {
    const url = bookPreviewUrl(book.shareToken);
    if (isTelegramInlineUrl(url)) kb.url("Открыть книгу", url);
    else kb.text("Открыть книгу", `preview:book:${book.id}`);
  }
  kb.text("Новая запись", "menu:new");
  if (isProActive(user)) {
    kb.row().text("Скачать PDF", "book:pdf");
  } else {
    kb.row().text("Pro · 2900 ⭐ за год", "pay:year");
  }

  // Use the AI cover if it exists. Read from disk via InputFile — cover URL is for the
  // browser, but Telegram fetches photos from URLs and can't reach localhost in dev.
  if (book?.coverUrl) {
    try {
      const coverPath = join(paths.storageDir, "covers", `${book.id}.png`);
      await ctx.replyWithPhoto(new InputFile(coverPath), {
        caption: `${title}\n${counter}`,
        reply_markup: kb
      });
      return;
    } catch {
      // File missing — fall through to text card.
    }
  }

  await ctx.reply([title, counter].join("\n"), { reply_markup: kb });
}

function shipDate(): string {
  const year = new Date().getFullYear();
  // Show only year if we are past December — otherwise pin to Dec 7 of current year.
  return `7 декабря ${year}`;
}
