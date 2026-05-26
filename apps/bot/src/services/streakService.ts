import { prisma } from "../lib/db.js";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Returns the Monday at 00:00 UTC for the week containing `date`.
function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // Sunday=0, Monday=1, …
  const diff = day === 0 ? 6 : day - 1; // shift to Monday
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export const STREAK_MILESTONES = new Set([2, 3, 5, 10, 25, 52]);

// Update the user's streak counter after a successful entry.
// - If the previous entry was in the same calendar week → streak unchanged.
// - If it was in the immediately preceding week → streak += 1.
// - Otherwise → streak resets to 1.
// Returns the new streak count and whether it just crossed a milestone.
export async function updateStreak(
  userId: string,
  now = new Date()
): Promise<{ streak: number; milestoneHit: boolean }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { streakWeeks: true, lastEntryWeekStart: true }
  });

  const thisWeek = weekStart(now);
  const prevWeek = new Date(thisWeek.getTime() - ONE_WEEK_MS);

  let newStreak: number;
  if (!user.lastEntryWeekStart) {
    newStreak = 1;
  } else {
    const last = weekStart(user.lastEntryWeekStart);
    if (last.getTime() === thisWeek.getTime()) {
      newStreak = user.streakWeeks; // already counted this week
    } else if (last.getTime() === prevWeek.getTime()) {
      newStreak = user.streakWeeks + 1;
    } else {
      newStreak = 1;
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { streakWeeks: newStreak, lastEntryWeekStart: thisWeek }
  });

  const milestoneHit =
    STREAK_MILESTONES.has(newStreak) && (!user.lastEntryWeekStart || weekStart(user.lastEntryWeekStart).getTime() !== thisWeek.getTime());
  return { streak: newStreak, milestoneHit };
}

export function streakMilestoneText(streak: number, language: "ru" | "en"): string | null {
  if (!STREAK_MILESTONES.has(streak)) return null;
  if (language === "en") {
    if (streak === 2) return "🔥 Two weeks in a row.";
    if (streak === 3) return "🔥 Three weeks in a row — you're building a book.";
    if (streak === 5) return "🔥 Five weeks in a row. The rhythm is real.";
    if (streak === 10) return "🔥 Ten weeks. A fifth of a year, written down.";
    if (streak === 25) return "🔥 Twenty-five weeks — half the year is yours.";
    if (streak === 52) return "🔥 Fifty-two weeks. The book is finished.";
    return null;
  }
  if (streak === 2) return "🔥 Две недели подряд.";
  if (streak === 3) return "🔥 Три недели подряд — ты строишь книгу.";
  if (streak === 5) return "🔥 Пятая неделя подряд. Это уже ритм.";
  if (streak === 10) return "🔥 Десять недель. Пятая часть года — на бумаге.";
  if (streak === 25) return "🔥 Двадцать пять — половина года записана.";
  if (streak === 52) return "🔥 Пятьдесят две недели. Книга собрана.";
  return null;
}
