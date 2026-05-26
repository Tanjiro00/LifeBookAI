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
import { t, isEnglish } from "../lib/i18n.js";
import { displayTitle } from "../services/bookTitleService.js";
import { ensureBookArtifacts } from "../services/bookComposer.js";

const TOTAL_SLOTS = 52;

// /book — single layout regardless of state. Cover (or simple placeholder) + 2 buttons.
export async function sendBook(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  track("book_opened", { userId: user.id });

  const [book, count] = await Promise.all([
    prisma.book.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, aiTitle: true, coverUrl: true, shareToken: true, titleSetByUser: true }
    }),
    prisma.page.count({ where: { userId: user.id } })
  ]);

  if (count === 0) {
    await ctx.reply(
      t(
        ctx,
        "Книга пока пустая. Расскажи момент — текстом или голосом, я открою первую страницу.",
        "The book is empty. Tell me a moment — text or voice — and I'll open page one."
      ),
      { reply_markup: new InlineKeyboard().text(t(ctx, "Новая запись", "New entry"), "menu:new") }
    );
    return;
  }

  // If the user has entries but no cover yet, kick off generation in the background
  // so it appears next time they open /book. Idempotent: ensureBookArtifacts no-ops
  // when nothing's due.
  if (book && !book.coverUrl && count >= 1) {
    void ensureBookArtifacts(user.id).catch(() => {});
  }

  const title = book ? displayTitle(book) : (isEnglish(ctx) ? "Your year's book" : "Книга твоего года");
  const counter = t(
    ctx,
    `${count} из ${TOTAL_SLOTS} записей · книга готова к ${shipDate(false)}`,
    `${count} of ${TOTAL_SLOTS} entries · book ready by ${shipDate(true)}`
  );

  const kb = new InlineKeyboard();
  if (book?.shareToken) {
    const url = bookPreviewUrl(book.shareToken);
    // Open inside Telegram as a Mini App when the URL is HTTPS-public; the
    // public /book/:shareToken route works both authenticated (better UX
    // inside Telegram) and unauthenticated (anyone with the link can read).
    if (url.startsWith("https://") && isTelegramInlineUrl(url)) {
      kb.webApp(t(ctx, "Открыть книгу", "Open book"), url);
    } else if (isTelegramInlineUrl(url)) {
      kb.url(t(ctx, "Открыть книгу", "Open book"), url);
    } else {
      kb.text(t(ctx, "Открыть книгу", "Open book"), `preview:book:${book.id}`);
    }
  }
  kb.text(t(ctx, "Новая запись", "New entry"), "menu:new");
  if (isProActive(user)) {
    kb.row().text(t(ctx, "Скачать PDF", "Download PDF"), "book:pdf");
  } else {
    kb.row().text(t(ctx, "Pro · 2900 ⭐ за год", "Pro · 2900 ⭐ / year"), "pay:year");
  }

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

function shipDate(en: boolean): string {
  const year = new Date().getFullYear();
  return en ? `December 7, ${year}` : `7 декабря ${year}`;
}
