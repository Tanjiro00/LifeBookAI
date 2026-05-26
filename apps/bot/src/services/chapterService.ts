import type { Chapter, Page } from "@prisma/client";
import { reviseChapterIntro, synthesizeChapter } from "@lifebook/ai";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { generateShareToken } from "./pageService.js";

// `/delete_last` removes the user's most recent entry (page). Its raw text in Entry stays
// soft-deleted (we just unlink the Page; the Entry row is removed too via cascade).
export async function deleteLatestPage(userId: string): Promise<Page | null> {
  const page = await prisma.page.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });
  if (!page) return null;
  await prisma.page.delete({ where: { id: page.id } });
  return page;
}

// Sprint 4.2 — Chapter orchestrator.
//
// Triggered by the chapterSynth queue (Sprint 4.6 worker). Walks the user's
// most-recent unchaptered current pages, calls the LLM synthesiser, and either:
//   - creates a Chapter row + links the included Pages (chapterId), or
//   - logs «not yet» and returns null when shouldCreateChapter=false.
//
// Trigger policy: the queue is enqueued after every page committal in
// pageService.ts; we check inside whether enough material has accumulated.
// CHAPTER_MIN_PAGES (4) is the floor; we wait for a clear coherent set rather
// than firing on a strict cadence.

const CHAPTER_MIN_PAGES = Number(process.env.CHAPTER_MIN_PAGES ?? 4);
const CHAPTER_MAX_PAGES = Number(process.env.CHAPTER_MAX_PAGES ?? 6);

export type SynthesizeForUserResult =
  | { status: "skipped"; reason: string }
  | { status: "created"; chapter: Chapter; rationale: string };

export async function synthesizeChapterForUser(
  userId: string
): Promise<SynthesizeForUserResult> {
  // 1. Collect the candidate pages: WEEKLY, isCurrent=true, no chapterId, oldest
  //    first, capped at CHAPTER_MAX_PAGES so the LLM's context stays small.
  const candidates = await prisma.page.findMany({
    where: { userId, kind: "WEEKLY", isCurrent: true, chapterId: null },
    orderBy: { createdAt: "asc" },
    take: CHAPTER_MAX_PAGES,
    select: {
      id: true,
      sceneTitle: true,
      sceneContent: true,
      summary: true,
      tags: true,
      mood: true,
      createdAt: true
    }
  });
  if (candidates.length < CHAPTER_MIN_PAGES) {
    return {
      status: "skipped",
      reason: `not_enough_pages (${candidates.length} < ${CHAPTER_MIN_PAGES})`
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { languageCode: true, writingStyle: true }
  });
  const language: "ru" | "en" =
    (user?.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";

  // 2. Look up previous chapter title (so the synthesizer doesn't repeat).
  const previousChapter = await prisma.chapter.findFirst({
    where: { userId, status: { in: ["USER_APPROVED", "DRAFT", "LOCKED_FOR_PDF"] } },
    orderBy: { orderIndex: "desc" },
    select: { title: true, orderIndex: true }
  });

  // 3. Active threads enrich theme detection without forcing the chapter title
  //    to be a thread name.
  const threads = await prisma.narrativeThread.findMany({
    where: { userId, status: { in: ["ACTIVE", "DORMANT"] } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { title: true, summary: true }
  });

  // 4. Synthesise.
  let synth;
  try {
    synth = await synthesizeChapter({
      language,
      pages: candidates.map((p) => ({
        id: p.id,
        title: p.sceneTitle,
        body: p.sceneContent,
        summary: p.summary,
        tags: p.tags,
        mood: p.mood,
        createdAt: p.createdAt.toISOString()
      })),
      previousChapterTitle: previousChapter?.title ?? null,
      threads,
      writingStyle: user?.writingStyle ?? null
    });
  } catch (err) {
    logger.warn(
      { event: "chapter.synth_failed", userId, err: { message: (err as Error).message } },
      "chapter.synth_failed"
    );
    return { status: "skipped", reason: "synth_threw" };
  }

  if (!synth.shouldCreateChapter) {
    logger.info(
      { event: "chapter.synth_held_off", userId, reason: synth.rationale, candidates: candidates.length },
      "chapter.synth_held_off"
    );
    return { status: "skipped", reason: synth.rationale };
  }

  // Pages the LLM picked must be a subset of candidates we offered. Filter
  // out any hallucinated ids defensively.
  const candidateIds = new Set(candidates.map((p) => p.id));
  const includedIds = synth.pageIds.filter((id) => candidateIds.has(id));
  if (includedIds.length < CHAPTER_MIN_PAGES) {
    return { status: "skipped", reason: "synth_picked_too_few_known_pages" };
  }

  // 5. Compute orderIndex (next slot per user) and period bounds.
  const nextOrder = (previousChapter?.orderIndex ?? -1) + 1;
  const includedRows = candidates.filter((p) => includedIds.includes(p.id));
  const periodStart = includedRows[0]?.createdAt ?? null;
  const periodEnd = includedRows[includedRows.length - 1]?.createdAt ?? null;

  // 6. Pick the user's first Book to attach the chapter to (if any). Books are
  //    auto-created in onboarding; for legacy users without one we leave bookId
  //    null and let the PDF orchestrator attach later.
  const book = await prisma.book.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });

  const chapter = await prisma.$transaction(async (tx) => {
    const created = await tx.chapter.create({
      data: {
        userId,
        bookId: book?.id ?? null,
        title: synth.title!,
        subtitle: synth.subtitle ?? null,
        intro: synth.intro!,
        summary: synth.summary!,
        themes: synth.themes,
        people: synth.people,
        places: synth.places,
        status: "DRAFT",
        orderIndex: nextOrder,
        periodStart,
        periodEnd,
        shareToken: generateShareToken(),
        version: 1
      }
    });
    // Link the picked pages to this chapter.
    await tx.page.updateMany({
      where: { id: { in: includedIds } },
      data: { chapterId: created.id }
    });
    return created;
  });

  logger.info(
    {
      event: "chapter.created",
      userId,
      chapterId: chapter.id,
      title: chapter.title,
      pageCount: includedIds.length,
      orderIndex: chapter.orderIndex
    },
    "chapter.created"
  );

  return { status: "created", chapter, rationale: synth.rationale };
}

// Sprint 4.5 — «Не нравится / переразбить». Returns the included pages to the
// unchaptered pool and deletes the DRAFT chapter row. The next chapterSynth
// run will try a different grouping.
export async function resplitChapter(userId: string, chapterId: string): Promise<boolean> {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, userId },
    select: { id: true, status: true }
  });
  if (!chapter) return false;
  // Locked or approved chapters can't be silently resplit — they're already part
  // of the user's accepted manuscript. Only DRAFT survives this.
  if (chapter.status !== "DRAFT") return false;
  await prisma.$transaction(async (tx) => {
    await tx.page.updateMany({ where: { chapterId, userId }, data: { chapterId: null } });
    await tx.chapter.delete({ where: { id: chapterId } });
  });
  logger.info({ event: "chapter.resplit", userId, chapterId }, "chapter.resplit");
  return true;
}

// Sprint 4.5 — rename a chapter (user-supplied title).
export async function renameChapter(
  userId: string,
  chapterId: string,
  newTitle: string
): Promise<Chapter | null> {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, userId }
  });
  if (!chapter) return null;
  const trimmed = newTitle.trim().slice(0, 120);
  if (!trimmed) return null;
  return prisma.chapter.update({
    where: { id: chapter.id },
    data: { title: trimmed, version: chapter.version + 1 }
  });
}

// Sprint 4.7 — weave a user-supplied detail into the chapter intro.
export async function addDetailToChapterIntro(
  userId: string,
  chapterId: string,
  userDetail: string,
  language: "ru" | "en" = "ru"
): Promise<Chapter | null> {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, userId }
  });
  if (!chapter) return null;
  const result = await reviseChapterIntro({
    language,
    chapterTitle: chapter.title,
    chapterSubtitle: chapter.subtitle,
    previousIntro: chapter.intro ?? "",
    userDetail
  });
  return prisma.chapter.update({
    where: { id: chapter.id },
    data: {
      intro: result.intro,
      version: chapter.version + 1
    }
  });
}
