import { Queue, type QueueOptions } from "bullmq";
import { config } from "../config.js";

// Sprint 0.7 — BullMQ queue factory.
//
// Five queues are declared up-front. Their workers live in queues/worker.ts and
// the per-queue job-handler files (e.g. embeddingJob.ts). Sprint 0 only declares
// the queues; handlers fill in over Sprints 1–5:
//
//   embedding         (Sprint 1) — compute and persist a vector for each new Page.
//   memoryMerge       (Sprint 3) — merge MemoryCandidates into MemoryEntity rows.
//   narrativeThreads  (Sprint 3) — update NarrativeThread state from EntryPlan.
//   chapterSynth      (Sprint 4) — group recent pages into a Chapter when ready.
//   styleAudit        (Sprint 5) — every N pages, audit voice drift.
//
// We expose a single typed enqueue helper per queue so callers don't have to
// reach for the Queue object directly. Queues share a connection through the
// existing ioredis client to avoid creating multiple Redis connections per
// process.

import { getRedis } from "../lib/redis.js";

export const QUEUE_NAMES = {
  embedding: "lifebook.embedding",
  memoryMerge: "lifebook.memory_merge",
  narrativeThreads: "lifebook.narrative_threads",
  chapterSynth: "lifebook.chapter_synth",
  styleAudit: "lifebook.style_audit"
} as const;

export type QueueName = keyof typeof QUEUE_NAMES;

// BullMQ requires its own Redis "connection" config — but it accepts an existing
// ioredis client. Reuse so we don't open one connection per queue.
function bullQueueOpts(): QueueOptions {
  return { connection: getRedis() };
}

const queues: Partial<Record<QueueName, Queue>> = {};

function getQueue(name: QueueName): Queue {
  if (!queues[name]) {
    queues[name] = new Queue(QUEUE_NAMES[name], bullQueueOpts());
  }
  return queues[name]!;
}

// ─── Typed enqueue helpers ──────────────────────────────────────────────────
// Each queue accepts a strongly typed payload. Handlers (Sprint 1+) read the
// same shape. Defaults: 3 attempts, exponential backoff, remove-on-complete.

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 }
};

export type EmbeddingJob = { pageId: string; userId: string };
export async function enqueueEmbedding(payload: EmbeddingJob): Promise<void> {
  if (!config.WORKER_ENABLED) return; // No-op when workers are off.
  await getQueue("embedding").add(`embed:${payload.pageId}`, payload, DEFAULT_JOB_OPTS);
}

// Sprint 3.6 — finalised memory + threads job payloads.
//
// Candidates come from EITHER the writer's EntryOutput.memoryUpdates OR the
// planner's EntryPlan.memoriesToCreateOrMerge. We send raw {type, name,
// evidence} triples here; memoryReviewService decides create-vs-merge.
export type MemoryMergeJob = {
  userId: string;
  pageId: string;
  language: "ru" | "en";
  candidates: Array<{
    type: string;
    name: string;
    evidence: string;
    confidence?: number;
    category?: string;
  }>;
};
export async function enqueueMemoryMerge(payload: MemoryMergeJob): Promise<void> {
  if (!config.WORKER_ENABLED) return;
  await getQueue("memoryMerge").add(`merge:${payload.pageId}`, payload, DEFAULT_JOB_OPTS);
}

// Threads job uses the planner's `threadsToUpdate` shape verbatim.
export type NarrativeThreadsJob = {
  userId: string;
  pageId: string;
  threadCandidates: Array<{
    threadId?: string;
    proposedTitle?: string;
    proposedType?: string;
    updateReason: string;
  }>;
};
export async function enqueueNarrativeThreads(payload: NarrativeThreadsJob): Promise<void> {
  if (!config.WORKER_ENABLED) return;
  await getQueue("narrativeThreads").add(`threads:${payload.pageId}`, payload, DEFAULT_JOB_OPTS);
}

export type ChapterSynthJob = { userId: string };
export async function enqueueChapterSynth(payload: ChapterSynthJob): Promise<void> {
  if (!config.WORKER_ENABLED) return;
  // Coalesce: per-user, only one in-flight chapterSynth job is meaningful.
  await getQueue("chapterSynth").add(`synth:${payload.userId}`, payload, {
    ...DEFAULT_JOB_OPTS,
    jobId: `synth:${payload.userId}`
  });
}

export type StyleAuditJob = { userId: string };
export async function enqueueStyleAudit(payload: StyleAuditJob): Promise<void> {
  if (!config.WORKER_ENABLED) return;
  await getQueue("styleAudit").add(`style:${payload.userId}`, payload, {
    ...DEFAULT_JOB_OPTS,
    jobId: `style:${payload.userId}`
  });
}

export async function closeQueues(): Promise<void> {
  for (const q of Object.values(queues)) {
    await q?.close();
  }
}
