import { MemoryType } from "@prisma/client";
import { prisma } from "../lib/db.js";

export type Stats = {
  totalPages: number;
  totalSlots: number;
  streakWeeks: number;
  topMoods: Array<{ value: string; count: number }>;
  topTags: Array<{ value: string; count: number }>;
  topPeople: Array<{ value: string; confidence: number }>;
  firstEntryAt: Date | null;
  lastEntryAt: Date | null;
};

const TOTAL_SLOTS = 52;

function topN<T extends string>(values: T[], n: number): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

export async function getStatsForUser(userId: string): Promise<Stats> {
  const [user, pages, people] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { streakWeeks: true } }),
    prisma.page.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { mood: true, tags: true, createdAt: true }
    }),
    prisma.memory.findMany({
      where: { userId, type: MemoryType.PERSON },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: 5,
      select: { title: true, confidence: true }
    })
  ]);

  return {
    totalPages: pages.length,
    totalSlots: TOTAL_SLOTS,
    streakWeeks: user.streakWeeks,
    topMoods: topN(pages.flatMap((p) => p.mood), 3),
    topTags: topN(pages.flatMap((p) => p.tags), 5),
    topPeople: people.map((p) => ({ value: p.title, confidence: p.confidence })),
    firstEntryAt: pages[0]?.createdAt ?? null,
    lastEntryAt: pages[pages.length - 1]?.createdAt ?? null
  };
}

export function formatStatsText(stats: Stats, language: "ru" | "en"): string {
  const lines: string[] = [];
  if (language === "en") {
    lines.push(`📖 ${stats.totalPages} of ${stats.totalSlots} entries`);
    if (stats.streakWeeks > 0) {
      lines.push(`🔥 Streak: ${stats.streakWeeks} ${stats.streakWeeks === 1 ? "week" : "weeks"}`);
    }
    if (stats.topMoods.length) {
      lines.push("", "Mood you write from most:");
      for (const m of stats.topMoods) lines.push(`  · ${m.value} — ${m.count}`);
    }
    if (stats.topTags.length) {
      lines.push("", "Themes that keep showing up:");
      for (const m of stats.topTags) lines.push(`  · ${m.value} — ${m.count}`);
    }
    if (stats.topPeople.length) {
      lines.push("", "People in your year:");
      for (const p of stats.topPeople) lines.push(`  · ${p.value}`);
    }
    if (stats.firstEntryAt && stats.lastEntryAt && stats.totalPages > 1) {
      const days = Math.max(1, Math.floor((stats.lastEntryAt.getTime() - stats.firstEntryAt.getTime()) / (24 * 60 * 60 * 1000)));
      lines.push("", `First page ${days} days ago. The shape of the year is starting to show.`);
    }
    if (stats.totalPages === 0) {
      lines.push("Nothing yet. Send your first moment — text or voice — and I'll start the book.");
    }
    return lines.join("\n");
  }

  lines.push(`📖 ${stats.totalPages} из ${stats.totalSlots} записей`);
  if (stats.streakWeeks > 0) {
    const word = stats.streakWeeks === 1 ? "неделя" : stats.streakWeeks < 5 ? "недели" : "недель";
    lines.push(`🔥 Стрик: ${stats.streakWeeks} ${word}`);
  }
  if (stats.topMoods.length) {
    lines.push("", "Состояния, в которых ты пишешь чаще всего:");
    for (const m of stats.topMoods) lines.push(`  · ${m.value} — ${m.count}`);
  }
  if (stats.topTags.length) {
    lines.push("", "Темы, которые повторяются:");
    for (const m of stats.topTags) lines.push(`  · ${m.value} — ${m.count}`);
  }
  if (stats.topPeople.length) {
    lines.push("", "Люди в твоём году:");
    for (const p of stats.topPeople) lines.push(`  · ${p.value}`);
  }
  if (stats.firstEntryAt && stats.lastEntryAt && stats.totalPages > 1) {
    const days = Math.max(1, Math.floor((stats.lastEntryAt.getTime() - stats.firstEntryAt.getTime()) / (24 * 60 * 60 * 1000)));
    lines.push("", `Первая страница ${days} дней назад. Год потихоньку проявляется.`);
  }
  if (stats.totalPages === 0) {
    lines.push("Пока пусто. Пришли первый момент — голосом или текстом, и я открою книгу.");
  }
  return lines.join("\n");
}
