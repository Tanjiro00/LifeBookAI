import { Worker, type Processor, type WorkerOptions } from "bullmq";
import { config } from "../config.js";
import { getRedis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { QUEUE_NAMES, type QueueName } from "./index.js";

// Sprint 0.7 — Worker boot.
//
// Workers are spawned in the same process as the bot when WORKER_ENABLED=true.
// In a larger deployment, run the bot with WORKER_ENABLED=false and a separate
// process with WORKER_ENABLED=true to scale workers independently.
//
// Each worker is assigned a small concurrency by default (2–5) so a flood of
// jobs doesn't starve the OpenAI rate limit or the Postgres connection pool.
// Handlers themselves (in queues/<queue>Job.ts) land in later sprints. Until
// then we register a no-op processor that logs the payload — useful for
// integration-testing the enqueue surface without the downstream side effects.

function bullWorkerOpts(extra: Partial<WorkerOptions> = {}): WorkerOptions {
  return { connection: getRedis(), ...extra };
}

const NOOP_PROCESSOR: Processor = async (job) => {
  logger.info(
    { queue: job.queueName, jobId: job.id, name: job.name, dataKeys: Object.keys(job.data ?? {}) },
    "queue.noop_handler"
  );
  return { ok: true, noop: true };
};

const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  // Embedding: chatty but cheap; 5 parallel is fine and matches OpenAI's RPM.
  embedding: 5,
  // Memory merge: LLM-bound, modest concurrency.
  memoryMerge: 2,
  // Narrative threads: LLM-bound, modest concurrency.
  narrativeThreads: 2,
  // Chapter synth: heavy LLM call; run one at a time per process.
  chapterSynth: 1,
  // Style audit: low frequency, safe to run one at a time.
  styleAudit: 1
};

const workers: Worker[] = [];

// Workers register against queue NAMES; the actual handler is provided by the
// caller. Sprint 0 boots all queues with NOOP_PROCESSOR; subsequent sprints
// replace the handlers via the registerHandler() entry-point.
const handlers: Partial<Record<QueueName, Processor>> = {};

export function registerHandler(name: QueueName, processor: Processor): void {
  handlers[name] = processor;
  // If a worker is already running for this queue, replace its handler by
  // closing and re-creating. Sprint 0 doesn't exercise this path; sprints that
  // add handlers will call registerHandler BEFORE startWorkers().
}

export async function startWorkers(): Promise<void> {
  if (!config.WORKER_ENABLED) {
    logger.info("WORKER_ENABLED=false — skipping queue workers");
    return;
  }
  for (const key of Object.keys(QUEUE_NAMES) as QueueName[]) {
    const handler = handlers[key] ?? NOOP_PROCESSOR;
    const w = new Worker(QUEUE_NAMES[key], handler, bullWorkerOpts({ concurrency: QUEUE_CONCURRENCY[key] }));
    w.on("failed", (job, err) => {
      logger.error(
        { queue: QUEUE_NAMES[key], jobId: job?.id, err: { message: err.message, stack: err.stack } },
        "queue.job_failed"
      );
    });
    w.on("error", (err) => {
      logger.error({ queue: QUEUE_NAMES[key], err: { message: err.message } }, "queue.worker_error");
    });
    workers.push(w);
  }
  logger.info({ workers: workers.length }, "queue.workers_started");
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
}
