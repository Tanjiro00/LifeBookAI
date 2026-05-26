import { embedText } from "@lifebook/ai";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";

// Sprint 1.4 — Retrieval primitive over pgvector.
//
// NB. Master spec §19 places this under packages/ai/src/context/. We keep it in
// apps/bot/src/services/retrieval/ because Prisma's client lives in the bot app
// and @lifebook/ai is meant to stay DB-free. Public surface is identical to
// what §19 would expect; only the import path differs.
//
// Returns the top-K current pages by cosine similarity to a query embedding.
// Then applies a Maximal Marginal Relevance (MMR) pass to diversify so callers
// don't get five near-duplicates.

export type RelatedPage = {
  pageId: string;
  title: string;
  body: string;
  summary: string | null;
  teaser: string | null;
  tags: string[];
  mood: string[];
  createdAt: Date;
  similarity: number;
  embedding: number[];
};

type RawRow = {
  pageId: string;
  title: string;
  body: string;
  summary: string | null;
  teaser: string | null;
  tags: string[];
  mood: string[];
  createdAt: Date;
  similarity: number;
  embeddingText: string; // pgvector returns vectors as text "[v1,v2,...]"
};

// Parse pgvector's text format "[1.2,3.4]" into number[].
function parseVectorText(text: string): number[] {
  if (!text) return [];
  return text
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => Number.parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Maximal Marginal Relevance: select items that maximize relevance to the query
// while penalising redundancy with already-selected items. lambda controls the
// query/diversity trade-off (1 = pure relevance, 0 = pure diversity).
function mmrSelect(
  candidates: RelatedPage[],
  k: number,
  queryEmbedding: number[],
  lambda = 0.7
): RelatedPage[] {
  const selected: RelatedPage[] = [];
  const pool = [...candidates];
  while (selected.length < k && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const cand = pool[i]!;
      const relevance = cand.similarity;
      let maxSim = 0;
      for (const sel of selected) {
        const sim = cosine(cand.embedding, sel.embedding);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    selected.push(pool.splice(bestIdx, 1)[0]!);
  }
  return selected;
}

export type RetrieveOptions = {
  userId: string;
  // Either supply a precomputed embedding or a query string we embed for you.
  queryEmbedding?: number[];
  queryText?: string;
  // Pages to exclude from results — typically the page being generated and its
  // recent neighbours that are passed in unconditionally.
  excludePageIds?: string[];
  // How many candidates to fetch from pgvector before MMR.
  candidatePoolSize?: number;
  // How many to return after MMR.
  topK?: number;
  // 0 < lambda <= 1; lower = more diverse, higher = more relevant. Default 0.7.
  mmrLambda?: number;
};

export async function retrieveRelatedPages(opts: RetrieveOptions): Promise<RelatedPage[]> {
  const candidatePoolSize = opts.candidatePoolSize ?? 10;
  const topK = opts.topK ?? 3;
  const lambda = opts.mmrLambda ?? 0.7;

  let queryEmbedding = opts.queryEmbedding;
  if (!queryEmbedding) {
    if (!opts.queryText?.trim()) {
      throw new Error("retrieveRelatedPages: either queryEmbedding or queryText is required");
    }
    const result = await embedText({ text: opts.queryText });
    queryEmbedding = result.embedding;
  }
  const queryLiteral = `[${queryEmbedding.join(",")}]`;
  const exclude = opts.excludePageIds ?? [];

  // Postgres array of strings parameter for the NOT IN filter. We use a UNNEST
  // to keep the query stable when the exclude list is empty.
  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT
      p."id"          AS "pageId",
      p."sceneTitle"  AS "title",
      p."sceneContent" AS "body",
      p."summary",
      p."teaser",
      p."tags",
      p."mood",
      p."createdAt",
      1 - (pe."embedding" <=> ${queryLiteral}::vector) AS "similarity",
      pe."embedding"::text AS "embeddingText"
    FROM "PageEmbedding" pe
    JOIN "Page" p ON p."id" = pe."pageId"
    WHERE pe."userId" = ${opts.userId}
      AND p."isCurrent" = true
      AND NOT (p."id" = ANY(${Prisma.sql`ARRAY[${Prisma.join(exclude.length ? exclude : [""])}]::text[]`}))
    ORDER BY pe."embedding" <=> ${queryLiteral}::vector
    LIMIT ${candidatePoolSize};
  `);

  const candidates: RelatedPage[] = rows.map((r) => ({
    pageId: r.pageId,
    title: r.title,
    body: r.body,
    summary: r.summary,
    teaser: r.teaser,
    tags: r.tags,
    mood: r.mood,
    createdAt: r.createdAt,
    similarity: Number(r.similarity ?? 0),
    embedding: parseVectorText(r.embeddingText)
  }));

  const selected = mmrSelect(candidates, topK, queryEmbedding, lambda);

  logger.info(
    {
      event: "retrieval.related_pages",
      userId: opts.userId,
      candidates: candidates.length,
      selected: selected.length,
      topPageIds: selected.map((s) => s.pageId),
      similarities: selected.map((s) => s.similarity)
    },
    "retrieval.related_pages"
  );

  return selected;
}
