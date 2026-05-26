// Sprint 3.8 — Narrative thread selection (real implementation).
//
// Picks up to N threads most likely to be relevant to the new entry. Strategy:
//   1. Hard-filter: status=ACTIVE OR (status=DORMANT AND updatedAt within 90d).
//   2. Score each thread:
//      - +3 per token from queryText found in title/summary/people/places/themes
//      - +2 if updated in last 14 days (recency boost)
//      - +1 if updated in last 45 days
//   3. Return top-K by score, tie-break by updatedAt DESC.
//
// Semantic embedding match over thread.summary is a future enhancement — bag-
// of-words is plenty for the typical handful of active threads per user.

import { normalize } from "@lifebook/ai";
import { prisma } from "../../lib/db.js";

export type NarrativeThreadSnippet = {
  threadId: string;
  title: string;
  summary: string;
  tension: string | null;
  lastMovement: string | null;
};

export type SelectThreadsInput = {
  userId: string;
  queryText?: string;
  topK?: number;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Tokenize same as memoryService — strip punct, lowercase, drop short tokens.
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = normalize(text);
  for (const tok of cleaned.split(/\s+/)) {
    if (tok.length > 3) out.add(tok);
  }
  return out;
}

export async function selectNarrativeThreads(input: SelectThreadsInput): Promise<NarrativeThreadSnippet[]> {
  const topK = input.topK ?? 5;
  const cutoff = new Date(Date.now() - 90 * ONE_DAY_MS);

  const threads = await prisma.narrativeThread.findMany({
    where: {
      userId: input.userId,
      OR: [
        { status: "ACTIVE" },
        { status: "DORMANT", updatedAt: { gte: cutoff } }
      ]
    },
    orderBy: { updatedAt: "desc" },
    take: 100, // upper bound; we score these in JS
    select: {
      id: true,
      title: true,
      summary: true,
      tension: true,
      lastMovement: true,
      people: true,
      places: true,
      themes: true,
      updatedAt: true
    }
  });
  if (threads.length === 0) return [];

  const queryTokens = input.queryText ? tokens(input.queryText) : new Set<string>();

  type Scored = (typeof threads)[number] & { score: number };
  const now = Date.now();
  const scored: Scored[] = threads.map((t) => {
    let score = 0;
    if (queryTokens.size) {
      const haystack = tokens(
        [t.title, t.summary, ...t.people, ...t.places, ...t.themes].join(" ")
      );
      for (const q of queryTokens) {
        if (haystack.has(q)) score += 3;
      }
    }
    const ageDays = (now - t.updatedAt.getTime()) / ONE_DAY_MS;
    if (ageDays <= 14) score += 2;
    else if (ageDays <= 45) score += 1;
    return { ...t, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  return scored.slice(0, topK).map((t) => ({
    threadId: t.id,
    title: t.title,
    summary: t.summary,
    tension: t.tension ?? null,
    lastMovement: t.lastMovement ?? null
  }));
}
