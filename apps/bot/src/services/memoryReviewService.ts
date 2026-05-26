import { type Memory, type MemoryType } from "@prisma/client";
import { mergeMemory, normalize } from "@lifebook/ai";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";

// Sprint 3.4 — Memory create-vs-merge orchestrator.
//
// The single write path for any new biographical fact. Replaces the legacy
// `prisma.memory.create()` calls scattered across pageService / intakeService.
//
// Algorithm:
//   1. normalize(name) → key
//   2. Try exact (userId, type, normalizedName) match.
//   3. If no exact match, look for fuzzy match (alias overlap, levenshtein
//      on canonical names, edit distance ≤ 2 for short names).
//   4. If a match is found → mergeMemory() (LLM) → update + create
//      MemoryRevision.
//   5. If no match → create a new Memory + create the initial MemoryRevision.
//
// Returns the resulting Memory along with the changeType for the caller (the
// «Я запомнил» follow-up uses this to phrase the message: "I remembered..." vs
// "I noted a new detail about...").

export type MemoryReviewInput = {
  userId: string;
  type: MemoryType;
  // The surface name the user used (or the writer extracted).
  rawName: string;
  // The new evidence prose.
  evidence: string;
  pageId?: string;
  language?: "ru" | "en";
  // INTAKE memories carry higher confidence; EXTRACTED defaults to 0.7.
  category?: string;
};

export type MemoryReviewResult = {
  memory: Memory;
  changeType: "confirm" | "add_detail" | "contradict" | "evolve" | "created";
  // True when this resulted in a new MemoryEntity row (vs merging into an
  // existing one). Useful for the follow-up message phrasing.
  created: boolean;
};

// Cheap Levenshtein for short strings — used as a tie-breaker when normalize()
// keys differ but names are very similar (e.g. typo, missing accent).
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(dp[j]!, dp[j - 1]!, prev);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

async function findCandidate(input: MemoryReviewInput): Promise<Memory | null> {
  const norm = normalize(input.rawName);
  if (!norm) return null;

  // (1) Exact (userId, type, normalizedName) match.
  const exact = await prisma.memory.findFirst({
    where: { userId: input.userId, type: input.type, normalizedName: norm }
  });
  if (exact) return exact;

  // (2) Alias overlap: existing rows whose `aliases` array contains either the
  // raw name or its normalized form. Postgres `has` operator works on text[].
  const aliasMatch = await prisma.memory.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      OR: [
        { aliases: { has: input.rawName.trim() } },
        { aliases: { has: norm } }
      ]
    }
  });
  if (aliasMatch) return aliasMatch;

  // (3) Fuzzy: pull a small window of recent same-type memories and compare
  // by edit distance on normalized names. We cap at 50 rows for performance —
  // anyone with more memories of the same type than that is a power user and
  // we'll add a proper trigram index in a follow-up sprint.
  const candidates = await prisma.memory.findMany({
    where: { userId: input.userId, type: input.type, normalizedName: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true, userId: true, type: true, category: true, title: true,
      content: true, confidence: true, normalizedName: true, aliases: true,
      sourcePageIds: true, doNotUse: true, sourceChapterId: true,
      createdAt: true, updatedAt: true
    }
  });
  for (const c of candidates) {
    if (!c.normalizedName) continue;
    // For short names (<6 chars), tighter threshold. For longer, allow more.
    const threshold = c.normalizedName.length < 6 ? 1 : 2;
    if (levenshtein(c.normalizedName, norm) <= threshold) {
      // Hydrate the rest of the row (the select above doesn't return Memory's full shape).
      return (await prisma.memory.findUnique({ where: { id: c.id } })) ?? null;
    }
  }
  return null;
}

export async function reviewAndStoreMemory(input: MemoryReviewInput): Promise<MemoryReviewResult> {
  const norm = normalize(input.rawName);
  if (!norm) {
    throw new Error("reviewAndStoreMemory: rawName normalised to empty");
  }

  const candidate = await findCandidate(input);

  if (candidate) {
    // ─── MERGE ───────────────────────────────────────────────────────────
    if (candidate.doNotUse) {
      // The user marked this entity as «do not use». Don't merge new evidence
      // into it. Return as-is so the caller can skip the «Я запомнил» follow-up.
      logger.info(
        { event: "memory.merge_skipped_do_not_use", memoryId: candidate.id, userId: input.userId },
        "memory.merge.do_not_use"
      );
      return { memory: candidate, changeType: "confirm", created: false };
    }

    const merge = await mergeMemory({
      language: input.language ?? "ru",
      type: input.type,
      canonicalName: candidate.title,
      existingSummary: candidate.content,
      knownAliases: candidate.aliases,
      newEvidence: input.evidence,
      ...(input.pageId ? { newEvidencePageId: input.pageId } : {})
    });

    // Compute the alias delta. The user's surface name (rawName) goes into
    // aliases if it differs from the canonical title (and isn't already there).
    const newAliasSet = new Set(candidate.aliases);
    if (input.rawName.trim() && input.rawName.trim() !== candidate.title) {
      newAliasSet.add(input.rawName.trim());
    }
    for (const a of merge.newAliases) newAliasSet.add(a);

    const sourcePageIds = input.pageId
      ? Array.from(new Set([...candidate.sourcePageIds, input.pageId]))
      : candidate.sourcePageIds;

    const updated = await prisma.memory.update({
      where: { id: candidate.id },
      data: {
        content: merge.newSummary,
        aliases: Array.from(newAliasSet),
        sourcePageIds,
        confidence: Math.min(1, Math.max(candidate.confidence, merge.confidence)),
        revisions: {
          create: {
            pageId: input.pageId ?? null,
            oldSummary: candidate.content,
            newSummary: merge.newSummary,
            reason: "merge",
            changeType: merge.changeType
          }
        }
      }
    });

    logger.info(
      {
        event: "memory.merged",
        memoryId: updated.id,
        userId: input.userId,
        type: input.type,
        changeType: merge.changeType,
        canonicalName: updated.title,
        addedAliases: Array.from(newAliasSet).filter((a) => !candidate.aliases.includes(a))
      },
      "memory.merged"
    );

    return { memory: updated, changeType: merge.changeType, created: false };
  }

  // ─── CREATE ────────────────────────────────────────────────────────────
  const created = await prisma.memory.create({
    data: {
      userId: input.userId,
      type: input.type,
      category: input.category ?? "EXTRACTED",
      title: input.rawName.trim(),
      content: input.evidence,
      confidence: 0.7,
      normalizedName: norm,
      aliases: [],
      sourcePageIds: input.pageId ? [input.pageId] : [],
      revisions: {
        create: {
          pageId: input.pageId ?? null,
          oldSummary: null,
          newSummary: input.evidence,
          reason: "initial",
          changeType: "add_detail"
        }
      }
    }
  });
  logger.info(
    {
      event: "memory.created",
      memoryId: created.id,
      userId: input.userId,
      type: input.type,
      canonicalName: created.title
    },
    "memory.created"
  );
  return { memory: created, changeType: "created", created: true };
}
