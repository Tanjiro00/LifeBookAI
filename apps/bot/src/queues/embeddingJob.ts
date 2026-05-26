import type { Processor } from "bullmq";
import { embedPage } from "../services/embeddingService.js";
import { logger } from "../lib/logger.js";
import type { EmbeddingJob } from "./index.js";

// Sprint 1.3 — Background embedding handler.
//
// Idempotent by construction: embedPage() short-circuits when bodyHash already
// matches what's stored. So retries (the queue's exponential backoff) are safe.
//
// Wired into the worker via registerHandler("embedding", processEmbeddingJob)
// from apps/bot/src/index.ts before startWorkers() is called.
export const processEmbeddingJob: Processor<EmbeddingJob> = async (job) => {
  const startedAt = Date.now();
  try {
    const result = await embedPage(job.data.pageId);
    const durationMs = Date.now() - startedAt;
    logger.info(
      {
        event: "embedding.job_done",
        jobId: job.id,
        pageId: job.data.pageId,
        userId: job.data.userId,
        result: result.status,
        reason: "reason" in result ? result.reason : undefined,
        durationMs
      },
      "queue.embedding.completed"
    );
    return result;
  } catch (err) {
    logger.error(
      {
        event: "embedding.job_failed",
        jobId: job.id,
        pageId: job.data.pageId,
        userId: job.data.userId,
        err: { message: (err as Error).message }
      },
      "queue.embedding.failed"
    );
    throw err;
  }
};
