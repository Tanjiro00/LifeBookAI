import type { User } from "@prisma/client";
import { embedText } from "@lifebook/ai";
import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { embedPage } from "../embeddingService.js";
import { retrieveRelatedPages, type RelatedPage } from "../retrieval/retrieveRelatedPages.js";
import { pickMemoriesForEntry, type MemoryForPrompt } from "../memoryService.js";
import {
  selectNarrativeThreads,
  type NarrativeThreadSnippet
} from "./selectNarrativeThreads.js";

// Sprint 1.5 — Narrative context builder.
//
// Owns the answer to: «what does the writer see when it sits down to pen the
// next page?». Master spec §5.1/§5.2 + late-stage chapter-delivery override
// dictate the shape. The builder is allowed to do I/O (Prisma, OpenAI for the
// query embedding) — it's a service, not a pure function — but it returns a
// fully-typed snapshot so downstream prompt builders are pure.
//
// Token budget: we hard-cap each section to keep the writer prompt under
// ~12k tokens (master spec §5.3). When the corpus grows past those limits we
// truncate older / less-relevant material — the live entry input is ALWAYS
// preserved in full.

const MAX_RECENT_BODIES = 2;
const MAX_PROLOGUE_BODIES = 5;
const MAX_RELATED_BODIES = 3;
const MAX_MEMORIES = 12;
const MAX_THREADS = 5;

// Per master spec §5.3 we want each body in the prompt around 800–1500 tokens.
// Russian averages ~1.5 chars/token, so cap each body string at 4000 chars and
// trust the writer prompt's own budgeter for the remainder. We ALWAYS truncate
// from the middle (not the end) so opening + closing image survive.
const BODY_CHAR_CAP = 4000;

export type PageSnippet = {
  pageId: string;
  title: string;
  body: string;
  teaser: string | null;
  summary: string | null;
  tags: string[];
  mood: string[];
  daysAgo: number;
  similarity?: number;
};

export type GenerationContext = {
  user: {
    id: string;
    language: "ru" | "en";
    firstName: string | null;
    writingStyle: string | null;
    styleSample: string | null;
    styleRecalibration: string | null;
    narrativeCompass: string | null;
    lifeContext: string | null;
  };
  currentEntry: {
    rawText: string;
    transcript?: string | null;
    finalInputText: string;
    entryType: "WEEKLY" | "RETROSPECTIVE" | "INTAKE_SCENE";
  };
  timeline: {
    pageNumber: number;
    daysSinceLastPage: number | null;
  };
  manuscriptContext: {
    prologueBodies: PageSnippet[];
    recentBodies: PageSnippet[];
    relatedBodies: PageSnippet[];
  };
  narrativeThreads: NarrativeThreadSnippet[];
  memories: MemoryForPrompt[];
  // Diagnostics — what got fetched and used. Persisted to Page.sourceContext in
  // Sprint 2 so we can audit which prior material informed each generation.
  diagnostics: {
    promptTextHash: string;
    relatedPageIds: string[];
    threadIds: string[];
    memoryTitles: string[];
    tokenEstimate: number;
  };
};

export type BuildContextInput = {
  user: User;
  // The text the user actually committed (transcript or rawText, post-confirmation).
  currentEntryText: string;
  rawText?: string | null;
  transcript?: string | null;
  entryType?: "WEEKLY" | "RETROSPECTIVE" | "INTAKE_SCENE";
  // The page being generated, if it's already been created. Excluded from
  // retrieval to avoid the page matching itself.
  excludePageIds?: string[];
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function daysAgoFrom(date: Date, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - date.getTime()) / ONE_DAY_MS));
}

function truncateBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= BODY_CHAR_CAP) return trimmed;
  // Middle-truncate: keep the first 60% and the last 30% so opening and closing
  // imagery (which the prompt asks the model to attend to) survive.
  const head = Math.floor(BODY_CHAR_CAP * 0.6);
  const tail = Math.floor(BODY_CHAR_CAP * 0.3);
  return `${trimmed.slice(0, head)}\n\n[…truncated…]\n\n${trimmed.slice(-tail)}`;
}

// Cheap token estimate — Russian/English averaging ~1 token per 3.5 chars.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function language(user: User): "ru" | "en" {
  return (user.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";
}

export async function buildNarrativeContext(input: BuildContextInput): Promise<GenerationContext> {
  const startedAt = Date.now();
  const userId = input.user.id;
  const exclude = new Set(input.excludePageIds ?? []);

  // ─── Always-include: 2 most recent current weekly bodies + prologue bodies ──
  const [recent, prologue] = await Promise.all([
    prisma.page.findMany({
      where: { userId, kind: "WEEKLY", isCurrent: true, NOT: { id: { in: [...exclude] } } },
      orderBy: { createdAt: "desc" },
      take: MAX_RECENT_BODIES,
      select: {
        id: true,
        sceneTitle: true,
        sceneContent: true,
        teaser: true,
        summary: true,
        tags: true,
        mood: true,
        createdAt: true
      }
    }),
    prisma.page.findMany({
      where: { userId, kind: "PROLOGUE", isCurrent: true },
      orderBy: { createdAt: "asc" },
      take: MAX_PROLOGUE_BODIES,
      select: {
        id: true,
        sceneTitle: true,
        sceneContent: true,
        teaser: true,
        summary: true,
        tags: true,
        mood: true,
        createdAt: true
      }
    })
  ]);

  const recentBodies: PageSnippet[] = recent.map((p) => ({
    pageId: p.id,
    title: p.sceneTitle,
    body: truncateBody(p.sceneContent),
    teaser: p.teaser,
    summary: p.summary,
    tags: p.tags,
    mood: p.mood,
    daysAgo: daysAgoFrom(p.createdAt)
  }));
  const prologueBodies: PageSnippet[] = prologue.map((p) => ({
    pageId: p.id,
    title: p.sceneTitle,
    body: truncateBody(p.sceneContent),
    teaser: p.teaser,
    summary: p.summary,
    tags: p.tags,
    mood: p.mood,
    daysAgo: daysAgoFrom(p.createdAt)
  }));

  // ─── Semantic retrieval: top-K related pages by cosine similarity ──────────
  // Embed once and reuse. We exclude pages already in recent/prologue to avoid
  // double-counting.
  const skipIds = new Set([
    ...exclude,
    ...recent.map((p) => p.id),
    ...prologue.map((p) => p.id)
  ]);

  let relatedBodies: PageSnippet[] = [];
  let queryEmbedding: number[] = [];
  try {
    const embedResult = await embedText({ text: input.currentEntryText });
    queryEmbedding = embedResult.embedding;
    const related = await retrieveRelatedPages({
      userId,
      queryEmbedding,
      excludePageIds: [...skipIds],
      candidatePoolSize: 10,
      topK: MAX_RELATED_BODIES
    });
    relatedBodies = related.map((r: RelatedPage) => ({
      pageId: r.pageId,
      title: r.title,
      body: truncateBody(r.body),
      teaser: r.teaser,
      summary: r.summary,
      tags: r.tags,
      mood: r.mood,
      daysAgo: daysAgoFrom(r.createdAt),
      similarity: r.similarity
    }));
  } catch (err) {
    // Retrieval failures must never block generation. The page can still be
    // written from current input + recent + prologue.
    logger.warn(
      { err: { message: (err as Error).message }, userId },
      "buildNarrativeContext: semantic retrieval failed; degrading"
    );
  }

  // ─── Threads stub (Sprint 3 fills this in) ──────────────────────────────────
  const threads = await selectNarrativeThreads({
    userId,
    queryText: input.currentEntryText,
    topK: MAX_THREADS
  });

  // ─── Memories: alias-aware keyword retrieval (existing service) ────────────
  const memories = await pickMemoriesForEntry({
    userId,
    entryText: input.currentEntryText,
    cap: MAX_MEMORIES
  });

  // ─── Compose pageNumber / timeline ──────────────────────────────────────────
  const pageNumber = (await prisma.page.count({
    where: { userId, kind: "WEEKLY", isCurrent: true }
  })) + 1;
  const lastPage = await prisma.page.findFirst({
    where: { userId, isCurrent: true },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true }
  });
  const daysSinceLastPage = lastPage ? daysAgoFrom(lastPage.createdAt) : null;

  // ─── Assemble ──────────────────────────────────────────────────────────────
  const context: GenerationContext = {
    user: {
      id: input.user.id,
      language: language(input.user),
      firstName: input.user.firstName ?? null,
      writingStyle: input.user.writingStyle ?? null,
      // Sprint 5 — voice calibration fields. styleSample is set during
      // onboarding; styleRecalibration is updated by the styleAudit worker.
      styleSample: input.user.styleSample ?? null,
      styleRecalibration: input.user.styleRecalibration ?? null,
      narrativeCompass: input.user.narrativeCompass ?? null,
      lifeContext: input.user.lifeContext ?? null
    },
    currentEntry: {
      rawText: input.rawText ?? input.currentEntryText,
      transcript: input.transcript ?? null,
      finalInputText: input.currentEntryText,
      entryType: input.entryType ?? "WEEKLY"
    },
    timeline: {
      pageNumber,
      daysSinceLastPage
    },
    manuscriptContext: {
      prologueBodies,
      recentBodies,
      relatedBodies
    },
    narrativeThreads: threads,
    memories,
    diagnostics: {
      promptTextHash: queryEmbedding.length ? "embedded" : "no_embedding",
      relatedPageIds: relatedBodies.map((p) => p.pageId),
      threadIds: threads.map((t) => t.threadId),
      memoryTitles: memories.map((m) => m.title),
      tokenEstimate: estimateTokens(
        [
          ...prologueBodies.map((p) => p.body),
          ...recentBodies.map((p) => p.body),
          ...relatedBodies.map((p) => p.body)
        ].join(" ")
      )
    }
  };

  // Lazy embed-on-read: if a recently-created page hasn't been embedded yet
  // (Sprint 1.3 backfill is async), warm it now so the next entry sees it.
  // Fire-and-forget — never gate generation on this.
  for (const p of [...recent, ...prologue]) {
    void embedPage(p.id).catch(() => {});
  }

  logger.info(
    {
      event: "context_built",
      userId,
      pageId: undefined,
      pageNumber,
      relatedPageIds: context.diagnostics.relatedPageIds,
      threadIds: context.diagnostics.threadIds,
      memoryCount: memories.length,
      recentBodyCount: recentBodies.length,
      prologueBodyCount: prologueBodies.length,
      tokenEstimate: context.diagnostics.tokenEstimate,
      durationMs: Date.now() - startedAt
    },
    "context_built"
  );

  return context;
}
