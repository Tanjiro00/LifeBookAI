import { randomBytes } from "node:crypto";
import { EntryStatus, type Entry, type Page, type User } from "@prisma/client";
import {
  detectContentLanguage,
  generateEntry,
  planEntry,
  validatePage,
  writePage,
  type EntryOutput,
  type EntryPlan
} from "@lifebook/ai";
import { pickWeekColor } from "@lifebook/renderer";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { track } from "./analytics.js";
// Sprint 1.3 — every newly created Page enqueues a background embedding job.
// The enqueue is a no-op when WORKER_ENABLED=false, so dev environments that
// don't want background work still function (they just won't have semantic
// retrieval until embeddings are computed lazily on first read in Sprint 1.4).
//
// Sprint 3.6 — same Page also enqueues memoryMerge and narrativeThreads jobs.
// Sprint 4.6 — and chapterSynth, which decides per-call whether enough
// material has accumulated to actually synthesise a chapter.
// All four queues fire AFTER the page is delivered so they never block UX.
import {
  enqueueChapterSynth,
  enqueueEmbedding,
  enqueueMemoryMerge,
  enqueueNarrativeThreads,
  enqueueStyleAudit
} from "../queues/index.js";
// Sprint 1.7 — manuscript-aware writer context.
import { buildNarrativeContext } from "./context/buildNarrativeContext.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function generateShareToken(): string {
  return randomBytes(20).toString("base64url");
}

function entryText(entry: Pick<Entry, "rawText" | "transcript">): string {
  return (entry.transcript || entry.rawText || "").trim();
}

// One weekly entry → one Page (lightweight). Auto-saved as soon as the entry comes in.
// The artifact is the response — there is no "save?" gate, no chapter synthesis flow,
// no bookkeeping the user can see.
export async function createPageForEntry(user: User, entry: Entry): Promise<Page> {
  const text = entryText(entry);
  const language = detectContentLanguage(text, user.languageCode);

  // Sprint 1.7 — full manuscript-aware context. Replaces the legacy "titles only"
  // recents path. The writer prompt now sees prologue/recent/related BODIES.
  const context = await buildNarrativeContext({
    user,
    currentEntryText: text,
    rawText: entry.rawText,
    transcript: entry.transcript,
    entryType: "WEEKLY"
  });

  // Compact-recents kept for backwards-compat logging in the prompt header.
  const now = Date.now();
  const recentTitles = await prisma.page.findMany({
    where: { userId: user.id, kind: "WEEKLY", isCurrent: true },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { sceneTitle: true, quote: true, tags: true, createdAt: true }
  });
  const recentForPrompt = recentTitles.map((p) => ({
    title: p.sceneTitle,
    quote: p.quote ?? null,
    tags: p.tags,
    daysAgo: Math.max(0, Math.floor((now - p.createdAt.getTime()) / ONE_DAY_MS))
  }));

  // ─── Sprint 2.4 — Two-pass writing: plan → write → validate → repair? ──────
  //
  // 1) planEntry decides pageRole + continuity moves the writer must hit.
  // 2) writePage renders the prose in line with the plan and the manuscript context.
  // 3) validatePage runs deterministic checks (length, paragraphs, generic clichés,
  //    continuity-fulfilment hint).
  // 4) If validation fails AND we have a repairInstruction, we ask the writer to
  //    revise once. After one repair attempt we ship as-is so we never block
  //    delivery for >30s — validation failures get logged for offline tuning.

  const plan = await planEntry({
    language,
    rawEntryOrTranscript: text,
    entryNumber: context.timeline.pageNumber,
    recentBodies: context.manuscriptContext.recentBodies,
    prologueBodies: context.manuscriptContext.prologueBodies,
    relatedBodies: context.manuscriptContext.relatedBodies,
    memories: context.memories,
    narrativeThreads: context.narrativeThreads,
    lifeContext: user.lifeContext,
    writingStyle: user.writingStyle ?? null,
    styleSample: context.user.styleSample ?? null
  });

  let output: EntryOutput = await writePage({
    rawEntryOrTranscript: text,
    language,
    recentEntries: recentForPrompt,
    recentBodies: context.manuscriptContext.recentBodies,
    prologueBodies: context.manuscriptContext.prologueBodies,
    relatedBodies: context.manuscriptContext.relatedBodies,
    memories: context.memories,
    entryNumber: context.timeline.pageNumber,
    lifeContext: user.lifeContext ?? null,
    plan
  });

  let validation = validatePage({ output, plan });
  let repaired = false;
  if (!validation.ok && validation.repairInstruction) {
    logger.info(
      {
        event: "page.validation_failed_first_pass",
        userId: user.id,
        errors: validation.errors,
        stats: validation.stats
      },
      "page.validation_failed_first_pass"
    );
    try {
      const repairedOutput = await writePage({
        rawEntryOrTranscript: `${text}\n\nEDITORIAL REPAIR NOTES (the previous draft tripped these checks — fix them):\n${validation.repairInstruction}`,
        language,
        recentEntries: recentForPrompt,
        recentBodies: context.manuscriptContext.recentBodies,
        prologueBodies: context.manuscriptContext.prologueBodies,
        relatedBodies: context.manuscriptContext.relatedBodies,
        memories: context.memories,
        entryNumber: context.timeline.pageNumber,
        lifeContext: user.lifeContext ?? null,
        plan
      });
      const revalidation = validatePage({ output: repairedOutput, plan });
      // Use the repaired output even if it still trips a check — it can't be
      // worse than the original (deterministic checks are monotonic-ish; the
      // small risk is the writer overcorrects, which is still acceptable for
      // a single-pass repair).
      output = repairedOutput;
      validation = revalidation;
      repaired = true;
    } catch (err) {
      logger.warn(
        { err: { message: (err as Error).message }, userId: user.id },
        "page.repair_attempt_failed"
      );
    }
  }

  if (!validation.ok) {
    // Ship anyway, but log so we can tune. Production observability will alert
    // on lba_validator_failed_total > threshold.
    logger.warn(
      {
        event: "page.validation_failed_final",
        userId: user.id,
        errors: validation.errors,
        stats: validation.stats,
        repaired
      },
      "page.validation_failed_final"
    );
  } else {
    logger.info(
      {
        event: "page.generated",
        userId: user.id,
        pageRole: plan.pageRole,
        continuityMoveCount: plan.continuityMoves.length,
        wordCount: validation.stats.wordCount,
        repaired
      },
      "page.generated"
    );
  }

  const accent = pickWeekColor({ mood: output.mood, tags: output.tags, fallbackSeed: output.title }).key;

  const page = await prisma.page.create({
    data: {
      userId: user.id,
      entryId: entry.id,
      sceneTitle: output.title,
      sceneContent: output.body,
      quote: output.quote ?? null,
      // The new model folds biographer-thread observations into the body itself.
      // We keep the column populated for legacy DB schema compatibility but don't surface it.
      biographerNote: "",
      // Sprint 0.4 — persist teaser + summary alongside the body. Both fields are
      // optional in the schema; pageDeliveryService falls back to deriving a
      // teaser from the body when teaser is null, but we want the model's own
      // teaser whenever it returned one.
      teaser: output.teaser ?? null,
      summary: output.pageSummary ?? null,
      mood: output.mood,
      tags: output.tags,
      accentColor: accent,
      shareToken: generateShareToken(),
      // Sprint 2.5 — persist the planner's intent. This is the «editor's
      // memo» that decided pageRole + continuity moves. Pairs with
      // sourceContext (Sprint 1.7) to give a full reconstructable trace of
      // the page's generation.
      generationPlan: plan as unknown as object,
      // Sprint 1.7 — persist what fed this generation so we can audit the
      // writer's continuity: which prior pages, which memories, which threads
      // shaped the page.
      sourceContext: {
        relatedPageIds: context.diagnostics.relatedPageIds,
        recentPageIds: context.manuscriptContext.recentBodies.map((p) => p.pageId),
        prologuePageIds: context.manuscriptContext.prologueBodies.map((p) => p.pageId),
        threadIds: context.diagnostics.threadIds,
        memoryTitles: context.diagnostics.memoryTitles,
        tokenEstimate: context.diagnostics.tokenEstimate,
        validation: {
          ok: validation.ok,
          errors: validation.errors,
          repaired
        }
      }
    }
  });

  // Sprint 3.6 — memory writes move to the background. The legacy in-line
  // `prisma.memory.create()` is gone; instead we enqueue a memoryMerge job
  // which:
  //   - dedupes via memoryReviewService (alias + stem-lite + levenshtein),
  //   - calls mergeMemory LLM to produce a rolling summary,
  //   - records a MemoryRevision row,
  //   - emits the «Я запомнил» follow-up to the user.
  //
  // We unify both sources of candidates: the writer's memoryUpdates (factual,
  // user-stated) and the planner's memoriesToCreateOrMerge (planner-flagged,
  // higher-level). De-dupe by (type, normalized name) at the candidate level
  // so we don't enqueue the same person twice.
  await prisma.entry.update({ where: { id: entry.id }, data: { status: EntryStatus.SAVED } });

  type MergeCandidate = { type: string; name: string; evidence: string; confidence?: number };
  const seen = new Set<string>();
  const candidates: MergeCandidate[] = [];
  const pushCandidate = (c: MergeCandidate) => {
    const key = `${c.type}::${c.name.trim().toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };
  for (const m of output.memoryUpdates) {
    pushCandidate({
      type: m.type,
      name: m.title,
      evidence: m.content,
      ...(m.confidence !== undefined ? { confidence: m.confidence } : {})
    });
  }
  for (const m of plan.memoriesToCreateOrMerge) {
    pushCandidate({ type: m.type, name: m.name, evidence: m.evidence });
  }
  if (candidates.length) {
    await enqueueMemoryMerge({
      userId: user.id,
      pageId: page.id,
      language: language as "ru" | "en",
      candidates
    }).catch(() => {});
  }

  // Sprint 3.6 — thread updates go through their own queue too. Planner-only;
  // the writer doesn't propose thread updates.
  if (plan.threadsToUpdate.length) {
    await enqueueNarrativeThreads({
      userId: user.id,
      pageId: page.id,
      threadCandidates: plan.threadsToUpdate.map((t) => ({
        ...(t.threadId ? { threadId: t.threadId } : {}),
        ...(t.proposedTitle ? { proposedTitle: t.proposedTitle } : {}),
        updateReason: t.updateReason
      }))
    }).catch(() => {});
  }

  // Sprint 4.6 — fire the chapter-synth job. The job itself decides whether
  // enough material has accumulated; it's idempotent per-user via jobId
  // coalescing in queues/index.ts.
  await enqueueChapterSynth({ userId: user.id }).catch(() => {});

  // Sprint 5.4 — every 5 weekly pages, fire the style auditor. JobId is
  // coalesced per user so back-to-back enqueues collapse into one. The
  // mod-5 gate keeps the OpenAI call rate roughly proportional to writing
  // cadence rather than firing on every page.
  if (context.timeline.pageNumber % 5 === 0) {
    await enqueueStyleAudit({ userId: user.id }).catch(() => {});
  }

  // Lazy-init book share token now that there is real content.
  const book = await prisma.book.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, shareToken: true }
  });
  if (book && !book.shareToken) {
    await prisma.book.update({ where: { id: book.id }, data: { shareToken: generateShareToken() } });
  }

  track("entry_created", {
    userId: user.id,
    pageId: page.id,
    entryNumber: context.timeline.pageNumber
  });
  // Fire-and-forget: embedding is needed for retrieval but never blocks delivery.
  // The job is idempotent (skips when bodyHash unchanged) so retries are safe.
  await enqueueEmbedding({ pageId: page.id, userId: user.id }).catch(() => {});
  return page;
}

export async function entryCountForUser(userId: string): Promise<number> {
  return prisma.page.count({ where: { userId, kind: "WEEKLY" } });
}

// Persist the AI-generated Prologue as a Page with kind=PROLOGUE. Reuses the standard
// EntryOutput schema so the existing card renderer / Page row layout works unchanged.
export async function createProloguePage(opts: {
  user: User;
  output: import("@lifebook/ai").EntryOutput;
}): Promise<Page> {
  const accent = pickWeekColor({ mood: opts.output.mood, tags: opts.output.tags, fallbackSeed: opts.output.title }).key;

  // Prologue has no source Entry row; we create a placeholder Entry so the existing
  // schema (Page.entryId is required and unique) holds.
  const placeholderEntry = await prisma.entry.create({
    data: {
      userId: opts.user.id,
      rawText: "[prologue]",
      status: EntryStatus.SAVED,
      periodEnd: new Date(),
      periodStart: new Date()
    }
  });

  const page = await prisma.page.create({
    data: {
      userId: opts.user.id,
      entryId: placeholderEntry.id,
      kind: "PROLOGUE",
      sceneTitle: opts.output.title,
      sceneContent: opts.output.body,
      quote: opts.output.quote ?? null,
      biographerNote: "",
      teaser: opts.output.teaser ?? null,
      summary: opts.output.pageSummary ?? null,
      mood: opts.output.mood,
      tags: opts.output.tags,
      accentColor: accent,
      shareToken: generateShareToken()
    }
  });
  // Same idempotent embedding enqueue for prologue pages — they participate in
  // retrieval too (pages can reference foundational scenes from intake).
  await enqueueEmbedding({ pageId: page.id, userId: opts.user.id }).catch(() => {});
  return page;
}
