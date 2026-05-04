import type { Chapter } from "@prisma/client";

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatChapterForTelegram(chapter: Chapter, chapterNumber: number): string {
  const paragraphs = chapter.content
    .split(/\n{2,}/)
    .map((paragraph) => escapeTelegramHtml(paragraph.trim()))
    .filter(Boolean)
    .join("\n\n");

  return [
    `📖 Глава ${chapterNumber}`,
    `<b>${escapeTelegramHtml(chapter.title)}</b>`,
    chapter.subtitle ? escapeTelegramHtml(chapter.subtitle) : "",
    "",
    chapter.quote ? `<i>“${escapeTelegramHtml(chapter.quote.replace(/[“”"]/g, ""))}”</i>` : "",
    "",
    paragraphs,
    "",
    "Сохранить эту главу в книгу?"
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}

export function formatSavedChapterText(savedCount: number, nextReminder?: string | null): string {
  return [
    "Глава сохранена.",
    "",
    `Теперь в твоей книге: ${savedCount} глав${savedCount === 1 ? "а" : savedCount < 5 ? "ы" : ""} из 52.`,
    nextReminder ? `Следующая глава — ${nextReminder}.` : "Следующая глава — когда ты будешь готов(а)."
  ].join("\n");
}

export function formatDateRange(start?: Date | null, end?: Date | null): string {
  if (!start || !end) {
    return "пока только первые главы";
  }

  const formatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
  const first = formatter.format(start);
  const last = formatter.format(end);
  return first === last ? first : `${first} — ${last}`;
}

