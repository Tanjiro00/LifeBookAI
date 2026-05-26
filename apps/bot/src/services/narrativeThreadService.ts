import { type NarrativeThread, type ThreadType, type User } from "@prisma/client";
import { updateNarrativeThread } from "@lifebook/ai";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";

// Sprint 3.5 service — Persists thread updates emitted by the planner.
//
// The planner returns `threadsToUpdate: [{ threadId?, proposedTitle?, updateReason }]`.
// For each entry:
//   - if threadId is set and exists → update the existing thread.
//   - if threadId is null/missing OR doesn't resolve → create a new thread.
//
// The service is idempotent in the «same page applied twice» sense: each call
// appends a NarrativeThreadEvent linked to the page, so duplicate enqueues
// produce duplicate events but never duplicate threads.

export type ThreadUpdateCandidate = {
  threadId?: string;
  proposedTitle?: string;
  proposedType?: string;
  updateReason: string;
};

function language(user: Pick<User, "languageCode">): "ru" | "en" {
  return (user.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";
}

function isThreadType(value: string | undefined): value is ThreadType {
  if (!value) return false;
  return [
    "PERSON",
    "RELATIONSHIP",
    "PLACE",
    "THEME",
    "GOAL",
    "FEAR",
    "IDENTITY",
    "WORK",
    "HEALTH",
    "FAMILY"
  ].includes(value);
}

export async function applyThreadUpdates(opts: {
  user: User;
  page: { id: string; sceneTitle: string; sceneContent: string; summary: string | null };
  candidates: ThreadUpdateCandidate[];
}): Promise<NarrativeThread[]> {
  const out: NarrativeThread[] = [];
  for (const cand of opts.candidates) {
    try {
      const updated = await applyOne(opts.user, opts.page, cand);
      if (updated) out.push(updated);
    } catch (err) {
      logger.warn(
        {
          err: { message: (err as Error).message },
          userId: opts.user.id,
          pageId: opts.page.id,
          candidate: cand
        },
        "narrativeThread.update_failed"
      );
    }
  }
  return out;
}

async function applyOne(
  user: User,
  page: { id: string; sceneTitle: string; sceneContent: string; summary: string | null },
  candidate: ThreadUpdateCandidate
): Promise<NarrativeThread | null> {
  // Resolve existing thread if planner specified an id.
  let existing: NarrativeThread | null = null;
  if (candidate.threadId) {
    existing = await prisma.narrativeThread.findFirst({
      where: { id: candidate.threadId, userId: user.id }
    });
  }

  const result = await updateNarrativeThread({
    language: language(user),
    thread: existing
      ? {
          id: existing.id,
          title: existing.title,
          type: existing.type,
          summary: existing.summary,
          tension: existing.tension,
          lastMovement: existing.lastMovement
        }
      : null,
    pageBody: page.sceneContent,
    pageTitle: page.sceneTitle,
    pageSummary: page.summary,
    updateReason: candidate.updateReason,
    ...(candidate.proposedTitle ? { proposedTitle: candidate.proposedTitle } : {}),
    ...(candidate.proposedType ? { proposedType: candidate.proposedType } : {})
  });

  if (existing) {
    const updated = await prisma.narrativeThread.update({
      where: { id: existing.id },
      data: {
        summary: result.newSummary,
        lastMovement: result.lastMovement,
        tension: result.tension ?? null,
        status: result.status,
        lastPageId: page.id,
        events: {
          create: {
            pageId: page.id,
            summary: result.lastMovement
          }
        }
      }
    });
    logger.info(
      { event: "thread.updated", threadId: updated.id, userId: user.id, status: updated.status },
      "thread.updated"
    );
    return updated;
  }

  // Create a new thread.
  const fallbackTitle =
    result.title ?? candidate.proposedTitle ?? candidate.updateReason.slice(0, 110);
  const proposedType = result.type ?? candidate.proposedType ?? "THEME";
  const type: ThreadType = isThreadType(proposedType) ? proposedType : "THEME";

  const created = await prisma.narrativeThread.create({
    data: {
      userId: user.id,
      title: fallbackTitle,
      type,
      summary: result.newSummary,
      lastMovement: result.lastMovement,
      tension: result.tension ?? null,
      firstPageId: page.id,
      lastPageId: page.id,
      status: result.status,
      events: { create: { pageId: page.id, summary: result.lastMovement } }
    }
  });
  logger.info(
    { event: "thread.created", threadId: created.id, userId: user.id, type, title: created.title },
    "thread.created"
  );
  return created;
}
