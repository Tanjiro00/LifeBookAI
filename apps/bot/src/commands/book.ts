import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { ensureTelegramUser } from "../services/userService.js";
import { getBookSummary, getLatestSavedChapter } from "../services/bookService.js";
import { formatDateRange } from "../services/formatting.js";
import { chapterPreviewUrl } from "../services/storage.js";
import { track } from "../services/analytics.js";
import { isTelegramInlineUrl } from "../services/urls.js";

export async function sendBook(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const summary = await getBookSummary(user.id);
  const latest = await getLatestSavedChapter(user.id);
  track("book_opened", { userId: user.id });

  const recent = summary.savedChapters.length
    ? summary.savedChapters.map((chapter, index) => `${index + 1}. ${chapter.title}`).join("\n")
    : "Пока нет сохранённых глав.";

  const keyboard = new InlineKeyboard();
  if (latest?.shareToken) {
    const url = chapterPreviewUrl(latest.shareToken);
    if (isTelegramInlineUrl(url)) {
      keyboard.url("Открыть красивую версию", url).row();
    } else {
      keyboard.text("Открыть красивую версию", `preview:chapter:${latest.id}`).row();
    }
  } else if (summary.book) {
    const url = `${config.PUBLIC_WEB_URL.replace(/\/$/, "")}/book/${summary.book.id}`;
    if (isTelegramInlineUrl(url)) {
      keyboard.url("Открыть красивую версию", url).row();
    } else {
      keyboard.text("Открыть красивую версию", `preview:book:${summary.book.id}`).row();
    }
  }
  keyboard.text("Последняя глава", "book:last").text("Экспорт PDF", "menu:export").row().text("Новая глава", "menu:new");

  await ctx.reply(
    [
      "📚 Твоя книга",
      "",
      `Название: ${summary.book?.title || "Год, когда я стал собой"}`,
      `Глав: ${summary.count} из 52`,
      `Период: ${formatDateRange(summary.periodStart, summary.periodEnd)}`,
      "",
      "Последние главы:",
      recent
    ].join("\n"),
    { reply_markup: keyboard }
  );
}
