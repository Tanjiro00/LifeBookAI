import type { Processor } from "bullmq";
import { applyThreadUpdates } from "../services/narrativeThreadService.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { track } from "../services/analytics.js";
import type { NarrativeThreadsJob } from "./index.js";

// Sprint 3.6 — narrative-threads worker.
//
// Consumes NarrativeThreadsJob payloads. Loads the user + the page's title +
// body + summary, then delegates to narrativeThreadService.applyThreadUpdates
// which loops over candidates and either upserts or creates threads.
//
// Idempotency: each call appends one NarrativeThreadEvent per thread. Re-running
// produces extra events but never duplicate threads (existing threads are
// looked up by id; new threads only get created when the candidate has no id).

export const processNarrativeThreadsJob: Processor<NarrativeThreadsJob> = async (job) => {
  const { userId, pageId, threadCandidates } = job.data;
  if (!threadCandidates.length) return { ok: true, processed: 0 };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, sceneTitle: true, sceneContent: true, summary: true }
  });
  if (!user || !page) {
    logger.warn(
      { event: "thread.job_skipped_missing_user_or_page", jobId: job.id, userId, pageId },
      "thread.job_skipped"
    );
    return { ok: true, processed: 0 };
  }

  const updated = await applyThreadUpdates({
    user,
    page,
    candidates: threadCandidates
  });

  for (const t of updated) {
    track("thread_updated", {
      userId,
      pageId,
      threadId: t.id,
      title: t.title
    });
  }

  logger.info(
    {
      event: "thread.batch_done",
      jobId: job.id,
      userId,
      pageId,
      processed: updated.length,
      threadIds: updated.map((t) => t.id)
    },
    "thread.batch_done"
  );

  return { ok: true, processed: updated.length };
};
