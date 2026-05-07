// Reminder + catch-up copy. Kept intentionally small: 4 reminder variants,
// one catch-up message at 14 days. No streak/milestone gamification — autobiography
// is a year-long arc, not a habit ladder.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const REMINDER_VARIANTS_RU: Array<(opts: { lastTitle?: string | null }) => string> = [
  ({ lastTitle }) =>
    lastTitle
      ? `Прошла неделя.\n\nВ прошлой записи ты писал(а) про «${lastTitle}». Что было в этой?`
      : "Прошла неделя.\n\nКакой момент хочется сохранить?",
  () => "Время одной записи.\n\nДаже две минуты голосового — этого хватит для страницы.",
  () => "Что из этой недели ты не хочешь забыть?\n\nГолосом — быстрее всего.",
  () => "Книга твоего года продолжается.\n\nРасскажи момент — я запишу его как страницу."
];

const REMINDER_VARIANTS_EN: Array<(opts: { lastTitle?: string | null }) => string> = [
  ({ lastTitle }) =>
    lastTitle ? `A week passed. Last time it was about "${lastTitle}". What about this one?` : "A week passed. What's one moment to keep?",
  () => "Time for one entry. Two minutes of voice is enough for a page.",
  () => "What from this week do you not want to forget?",
  () => "Your year keeps going. Tell me a moment."
];

export function pickReminderText(opts: {
  language: "ru" | "en";
  lastTitle?: string | null;
  weekIndex: number;
}): string {
  const variants = opts.language === "en" ? REMINDER_VARIANTS_EN : REMINDER_VARIANTS_RU;
  return variants[opts.weekIndex % variants.length]!(opts);
}

export function shouldSendCatchup(opts: {
  daysSinceLastEntry: number;
  lastCatchupAt: Date | null | undefined;
}): boolean {
  // Single threshold: at 14 days of silence. Don't pile on after that — at day 30 the user
  // is gone anyway and another nag won't help.
  if (opts.daysSinceLastEntry < 14 || opts.daysSinceLastEntry > 16) return false;
  if (!opts.lastCatchupAt) return true;
  return Date.now() - opts.lastCatchupAt.getTime() > 6 * ONE_DAY_MS;
}

export function catchupText(language: "ru" | "en", lastTitle?: string | null): string {
  if (language === "en") {
    return lastTitle
      ? `Two weeks since "${lastTitle}". One small moment from in between is enough — even if it doesn't feel like a story yet.`
      : "Two weeks of silence. One small moment from in between is enough.";
  }
  return lastTitle
    ? `Две недели с записи «${lastTitle}». Один момент из этого промежутка — достаточно, даже если не складывается в историю.`
    : "Две недели без записи. Один момент из промежутка — этого хватит.";
}
