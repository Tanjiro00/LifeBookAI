import { MemoryType, type Memory } from "@prisma/client";
import { prisma } from "../lib/db.js";

const TYPE_LABELS_RU: Record<MemoryType, string> = {
  PERSON: "👥 Люди",
  PLACE: "📍 Места",
  THEME: "🎭 Темы",
  LIFE_EVENT: "🌟 События",
  GOAL: "🎯 Цели",
  FEAR: "💭 Страхи",
  ACHIEVEMENT: "🏆 Достижения",
  PREFERENCE: "💡 Предпочтения"
};

const TYPE_LABELS_EN: Record<MemoryType, string> = {
  PERSON: "👥 People",
  PLACE: "📍 Places",
  THEME: "🎭 Themes",
  LIFE_EVENT: "🌟 Life events",
  GOAL: "🎯 Goals",
  FEAR: "💭 Fears",
  ACHIEVEMENT: "🏆 Achievements",
  PREFERENCE: "💡 Preferences"
};

export function memoryTypeLabel(type: MemoryType, language: "ru" | "en"): string {
  return (language === "en" ? TYPE_LABELS_EN : TYPE_LABELS_RU)[type];
}

export async function listMemories(userId: string): Promise<Memory[]> {
  return prisma.memory.findMany({
    where: { userId },
    orderBy: [{ type: "asc" }, { confidence: "desc" }, { updatedAt: "desc" }]
  });
}

export async function deleteMemory(userId: string, memoryId: string): Promise<boolean> {
  const result = await prisma.memory.deleteMany({ where: { id: memoryId, userId } });
  return result.count > 0;
}

export async function updateMemoryContent(userId: string, memoryId: string, content: string): Promise<boolean> {
  // Sprint 3.7 — user-edited content also appends a MemoryRevision so the
  // entity has a complete change log (system-merged + user-edited entries
  // alike). We keep the prior content as oldSummary for audit.
  const memory = await prisma.memory.findFirst({
    where: { id: memoryId, userId },
    select: { id: true, content: true }
  });
  if (!memory) return false;
  await prisma.memory.update({
    where: { id: memory.id },
    data: {
      content,
      revisions: {
        create: {
          oldSummary: memory.content,
          newSummary: content,
          reason: "user_edit",
          changeType: "evolve"
        }
      }
    }
  });
  return true;
}

export function groupByType(memories: Memory[]): Map<MemoryType, Memory[]> {
  const map = new Map<MemoryType, Memory[]>();
  for (const m of memories) {
    const arr = map.get(m.type) ?? [];
    arr.push(m);
    map.set(m.type, arr);
  }
  return map;
}

// Lightweight tokenizer for keyword overlap. Splits on non-letter chars, lowercases,
// drops anything ≤ 3 chars (common Russian/English stop-particles like "что", "the", "и").
// We don't go via a stopword list — short words also tend to be poor signal anyway.
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\d]+/u)) {
    if (raw.length > 3) out.add(raw);
  }
  return out;
}

export type MemoryForPrompt = {
  type: Memory["type"];
  title: string;
  content: string;
};

// Pick up to N memories for the next page-generation prompt:
//  1) Always include INTAKE memories first (they're the foundational biography).
//  2) Then EXTRACTED memories whose title+content keywords overlap the new entry text
//     (so a weekly entry mentioning "мама" pulls the 6-month-old memory of "мама"
//     rather than the freshest 10 by updatedAt).
//  3) Pad with the most-recently-touched extracted memories until we hit the cap.
export async function pickMemoriesForEntry(opts: {
  userId: string;
  entryText: string;
  cap?: number;
}): Promise<MemoryForPrompt[]> {
  const cap = opts.cap ?? 12;
  const all = await prisma.memory.findMany({
    where: { userId: opts.userId },
    orderBy: [{ updatedAt: "desc" }],
    take: 200
  });
  if (!all.length) return [];

  const intake = all.filter((m) => m.category === "INTAKE");
  const extracted = all.filter((m) => m.category !== "INTAKE");

  const haystack = tokens(opts.entryText);
  const score = (m: Memory): number => {
    const text = `${m.title} ${m.content}`;
    let hits = 0;
    for (const tok of tokens(text)) if (haystack.has(tok)) hits += 1;
    return hits;
  };

  // Boost extracted memories whose tokens appear in the entry; tie-break by recency.
  const boostedExtracted = [...extracted].sort((a, b) => {
    const sa = score(a), sb = score(b);
    if (sb !== sa) return sb - sa;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  const ordered: Memory[] = [];
  const seen = new Set<string>();
  const push = (arr: Memory[]) => {
    for (const m of arr) {
      if (ordered.length >= cap) break;
      if (seen.has(m.id)) continue;
      ordered.push(m);
      seen.add(m.id);
    }
  };
  push(intake);
  push(boostedExtracted);

  return ordered.map((m) => ({ type: m.type, title: m.title, content: m.content }));
}
