import { refreshPrologue } from "@lifebook/ai";
import { type Page, type User } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { generateShareToken } from "./pageService.js";
import { enqueueEmbedding } from "../queues/index.js";

// Sprint 5.3 — Prologue refresh service.
//
// Reads the existing PROLOGUE pages, the user's intake memories, and the most
// recent weekly bodies; calls refreshPrologue (LLM); persists each refreshed
// page as a NEW Page row with version+1 and revisionOfId pointing at the prior
// prologue page. Same versioning shape as Sprint 2's revisePage.
//
// We re-embed each new prologue page (idempotent — bodyHash dedupe).
//
// The trigger UX (Telegram message asking «refresh now?») is implemented in
// the bot conversation; this service is just the persistence side. It never
// runs automatically — the user explicitly opts in.

const PROLOGUE_REFRESH_AFTER_PAGES = Number(process.env.PROLOGUE_REFRESH_AFTER_PAGES ?? 8);

export type RefreshEligibility =
  | { eligible: false; reason: "no_prologue" | "not_enough_pages" | "none_to_refresh" }
  | { eligible: true; weeklyCount: number; prologueCount: number };

export async function isPrologueRefreshEligible(userId: string): Promise<RefreshEligibility> {
  const [prologueCount, weeklyCount] = await Promise.all([
    prisma.page.count({ where: { userId, kind: "PROLOGUE", isCurrent: true } }),
    prisma.page.count({ where: { userId, kind: "WEEKLY", isCurrent: true } })
  ]);
  if (prologueCount === 0) return { eligible: false, reason: "no_prologue" };
  if (weeklyCount < PROLOGUE_REFRESH_AFTER_PAGES) return { eligible: false, reason: "not_enough_pages" };
  return { eligible: true, weeklyCount, prologueCount };
}

export type RefreshResult = {
  refreshed: number;
  newPageIds: string[];
};

export async function refreshUserPrologue(user: User): Promise<RefreshResult> {
  const language: "ru" | "en" = (user.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";

  const [previousPrologue, intakeMemories, recentWeekly] = await Promise.all([
    prisma.page.findMany({
      where: { userId: user.id, kind: "PROLOGUE", isCurrent: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.memory.findMany({
      where: { userId: user.id, category: "INTAKE", doNotUse: false },
      orderBy: [{ type: "asc" }, { confidence: "desc" }]
    }),
    prisma.page.findMany({
      where: { userId: user.id, kind: "WEEKLY", isCurrent: true },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { sceneTitle: true, sceneContent: true }
    })
  ]);
  if (previousPrologue.length === 0) {
    return { refreshed: 0, newPageIds: [] };
  }

  const result = await refreshPrologue({
    language,
    intakeMemories: intakeMemories.map((m) => ({ type: m.type, title: m.title, content: m.content })),
    previousPrologue: previousPrologue.map((p, i) => ({
      pageNumber: i + 1,
      title: p.sceneTitle,
      body: p.sceneContent
    })),
    recentBodies: recentWeekly
      .reverse()
      .map((p) => ({ title: p.sceneTitle, body: p.sceneContent })),
    writingStyle: user.writingStyle,
    styleSample: user.styleSample,
    narrativeCompass: user.narrativeCompass
  });

  if (result.pages.length !== previousPrologue.length) {
    logger.warn(
      {
        event: "prologue.refresh_count_mismatch",
        userId: user.id,
        expected: previousPrologue.length,
        got: result.pages.length
      },
      "prologue.refresh_count_mismatch"
    );
  }
  // Pair refreshed outputs to previous pages by index up to the lesser of the two.
  const pairCount = Math.min(result.pages.length, previousPrologue.length);

  const newPages: Page[] = [];
  for (let i = 0; i < pairCount; i += 1) {
    const prev = previousPrologue[i]!;
    const out = result.pages[i]!;
    const next = await prisma.$transaction(async (tx) => {
      // Move shareToken to a versioned suffix on the prev row, flip prev to
      // not-current, then create the new revision with the inherited token.
      if (prev.shareToken) {
        await tx.page.update({
          where: { id: prev.id },
          data: { shareToken: `${prev.shareToken}-v${prev.version}` }
        });
      }
      await tx.page.update({ where: { id: prev.id }, data: { isCurrent: false } });
      return tx.page.create({
        data: {
          userId: prev.userId,
          entryId: prev.entryId,
          kind: "PROLOGUE",
          sceneTitle: out.title,
          sceneContent: out.body,
          quote: out.quote ?? null,
          teaser: out.teaser ?? null,
          summary: out.pageSummary ?? null,
          biographerNote: "",
          mood: out.mood,
          tags: out.tags,
          accentColor: prev.accentColor,
          version: prev.version + 1,
          revisionOfId: prev.id,
          isCurrent: true,
          shareToken: prev.shareToken,
          sourceContext: { refreshedFrom: prev.id, refreshedAt: new Date().toISOString() }
        }
      });
    });
    newPages.push(next);
    await enqueueEmbedding({ pageId: next.id, userId: next.userId }).catch(() => {});
  }

  logger.info(
    {
      event: "prologue.refreshed",
      userId: user.id,
      newPageIds: newPages.map((p) => p.id),
      count: newPages.length
    },
    "prologue.refreshed"
  );
  return { refreshed: newPages.length, newPageIds: newPages.map((p) => p.id) };
}