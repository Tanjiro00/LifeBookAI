import type { Chapter } from "@prisma/client";
import { splitForTelegram } from "../lib/messageSplit.js";
import { chaptersWord } from "../lib/plural.js";

const MAX_CHAPTER_BODY_INLINE = 3500; // leave room for header + quote + escape growth

export function escapeTelegramHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function header(chapter: Chapter, chapterNumber: number): string {
  return [
    `📖 Глава ${chapterNumber}`,
    `<b>${escapeTelegramHtml(chapter.title)}</b>`,
    chapter.subtitle ? escapeTelegramHtml(chapter.subtitle) : "",
    "",
    chapter.quote ? `<i>“${escapeTelegramHtml(chapter.quote.replace(/[“”"]/g, ""))}”</i>` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function bodyHtml(chapter: Chapter): string {
  return chapter.content
    .split(/\n{2,}/)
    .map((paragraph) => escapeTelegramHtml(paragraph.trim()))
    .filter(Boolean)
    .join("\n\n");
}

// Returns 1..N message bodies, all under Telegram's 4096-char hard limit.
// Header always lives in the first message.
export function formatChapterMessages(chapter: Chapter, chapterNumber: number): string[] {
  const head = header(chapter, chapterNumber);
  const body = bodyHtml(chapter);

  if (body.length <= MAX_CHAPTER_BODY_INLINE) {
    return [`${head}\n\n${body}\n\nСохранить эту главу в книгу?`];
  }

  const parts = splitForTelegram(body, MAX_CHAPTER_BODY_INLINE);
  const messages: string[] = [];
  messages.push(`${head}\n\n${parts[0]}`);
  for (let i = 1; i < parts.length - 1; i += 1) {
    messages.push(parts[i]!);
  }
  messages.push(`${parts.at(-1)}\n\nСохранить эту главу в книгу?`);
  return messages;
}

export function formatSavedChapterText(opts: {
  savedCount: number;
  nextReminder?: string | null;
  streakWeeks?: number;
  milestoneTitle?: string | null;
  milestoneBody?: string | null;
}): string {
  const lines: string[] = [];

  if (opts.milestoneTitle) {
    lines.push(opts.milestoneTitle, "");
    if (opts.milestoneBody) lines.push(opts.milestoneBody, "");
  } else {
    lines.push("Глава сохранена.", "");
  }

  lines.push(`В книге уже ${opts.savedCount} ${chaptersWord(opts.savedCount)} из 52.`);

  if (opts.streakWeeks && opts.streakWeeks >= 2) {
    lines.push(`🔥 ${opts.streakWeeks} ${opts.streakWeeks === 1 ? "неделя" : "недели"} подряд.`);
  }

  lines.push("", opts.nextReminder ? `Следующая глава — ${opts.nextReminder}.` : "Следующая — когда будешь готов(а).");
  return lines.join("\n");
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
