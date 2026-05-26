import { run } from "@grammyjs/runner";
import { createBot, setBotCommands } from "./bot.js";
import { config } from "./config.js";
import { createServer } from "./server.js";
import { prisma } from "./lib/db.js";
import { closeRedis } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
import { ensureStorageDirs } from "./services/storage.js";
import { startReminderLoop } from "./services/reminders.js";
// Sprint 0.7 — BullMQ workers run in-process when WORKER_ENABLED=true.
import { startWorkers, stopWorkers, registerHandler } from "./queues/worker.js";
import { closeQueues } from "./queues/index.js";
// Sprint 5.7 — daily hard-delete sweep.
import { startHardDeleteLoop } from "./services/deletionWorker.js";
// Sprint 5 tail — Sentry + Prometheus.
import { initSentry, captureError } from "./lib/observability.js";
// Sprint 1.3 — embedding job handler.
import { processEmbeddingJob } from "./queues/embeddingJob.js";
// Sprint 3.6 — memory + thread job handlers.
import { processMemoryMergeJob } from "./queues/memoryMergeJob.js";
import { processNarrativeThreadsJob } from "./queues/narrativeThreadJob.js";
// Sprint 4.6 — chapter synth job handler.
import { processChapterSynthJob } from "./queues/chapterSynthJob.js";
// Sprint 5.4 — style audit handler.
import { processStyleAuditJob } from "./queues/styleAuditJob.js";
// Product analytics — drain PostHog buffer on graceful shutdown.
import { shutdownAnalytics } from "./services/analytics.js";

async function connectWithTimeout(timeoutMs = 10_000): Promise<void> {
  await Promise.race([
    prisma.$connect(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Database not reachable within ${Math.round(timeoutMs / 1000)}s. Check DATABASE_URL.`)),
        timeoutMs
      )
    )
  ]);
}

async function main(): Promise<void> {
  initSentry();
  await ensureStorageDirs();
  await connectWithTimeout();

  const bot = createBot();
  await setBotCommands(bot);

  const server = createServer(bot);
  await server.listen({ port: config.PORT, host: "0.0.0.0" });

  // Reminder loop runs in both modes — production uses webhook and still needs reminders.
  const reminderTimer = startReminderLoop(bot);
  // Sprint 5.7 — hard-delete sweep runs hourly and clears users whose
  // deletionRequestedAt is past the grace period.
  const deletionTimer = startHardDeleteLoop();
  // BullMQ handlers must register BEFORE startWorkers() so the worker picks
  // them up; otherwise it starts with the no-op handler from Sprint 0.
  registerHandler("embedding", processEmbeddingJob);
  registerHandler("memoryMerge", processMemoryMergeJob);
  registerHandler("narrativeThreads", processNarrativeThreadsJob);
  registerHandler("chapterSynth", processChapterSynthJob);
  registerHandler("styleAudit", processStyleAuditJob);
  await startWorkers();
  let runner: ReturnType<typeof run> | undefined;

  if (config.BOT_MODE === "webhook") {
    if (!config.BOT_WEBHOOK_URL) {
      throw new Error("BOT_WEBHOOK_URL is required in webhook mode.");
    }
    const webhookUrl = `${config.BOT_WEBHOOK_URL.replace(/\/$/, "")}/telegram/webhook`;
    await bot.api.setWebhook(
      webhookUrl,
      config.TELEGRAM_WEBHOOK_SECRET ? { secret_token: config.TELEGRAM_WEBHOOK_SECRET } : {}
    );
    logger.info({ webhookUrl }, "LifeBook Bot webhook is ready");
  } else {
    // If a webhook was previously registered, polling will conflict with it.
    await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => undefined);
    runner = run(bot);
    logger.info({ port: config.PORT }, "LifeBook Bot polling is ready");
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down LifeBook Bot");
    if (reminderTimer) clearInterval(reminderTimer);
    if (deletionTimer) clearInterval(deletionTimer);
    await runner?.stop();
    await server.close();
    await stopWorkers();
    await closeQueues();
    await closeRedis();
    await shutdownAnalytics();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (error) => {
  logger.fatal({ err: error }, "LifeBook Bot failed to start");
  captureError(error, { phase: "startup" });
  await prisma.$disconnect();
  process.exit(1);
});
