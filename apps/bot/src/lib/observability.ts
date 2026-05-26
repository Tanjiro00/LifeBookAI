import * as Sentry from "@sentry/node";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import { config } from "../config.js";
import { logger } from "./logger.js";

// Sprint 5 tail — Observability bootstrap.
//
// Sentry: error tracking. Initialized at startup when SENTRY_DSN is set; no-op
// otherwise so dev environments don't need a DSN.
//
// Prometheus: scrape-target on /metrics. We define a small set of high-signal
// counters/histograms that match what master spec §17.3 listed:
//   - lba_writer_latency_ms              (histogram)
//   - lba_retrieval_latency_ms           (histogram)
//   - lba_pdf_render_latency_ms          (histogram)
//   - lba_embedding_jobs_total{status}   (counter)
//   - lba_chapter_synth_total            (counter)
//   - lba_validator_repair_total         (counter)
//   - lba_paywall_after_chapter_shown    (counter)
//
// Plus collectDefaultMetrics() for process / GC / event-loop stats.

export function initSentry(): void {
  if (!config.SENTRY_DSN) {
    logger.info("SENTRY_DSN not set — Sentry disabled");
    return;
  }
  try {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV,
      tracesSampleRate: 0.1,
      // Don't auto-instrument HTTP — it's noisy in our Fastify setup; we only
      // want explicit captureException / captureMessage from our code.
      integrations: []
    });
    logger.info("Sentry initialized");
  } catch (err) {
    logger.warn({ err }, "Sentry init failed — continuing without it");
  }
}

export function captureError(err: unknown, ctx?: Record<string, unknown>): void {
  if (!config.SENTRY_DSN) return;
  try {
    Sentry.withScope((scope) => {
      if (ctx) {
        for (const [k, v] of Object.entries(ctx)) {
          scope.setExtra(k, v);
        }
      }
      Sentry.captureException(err);
    });
  } catch {
    /* observability must never throw */
  }
}

// ─── Prometheus registry ────────────────────────────────────────────────────

export const promRegistry = new Registry();

collectDefaultMetrics({ register: promRegistry, prefix: "lba_" });

export const writerLatencyMs = new Histogram({
  name: "lba_writer_latency_ms",
  help: "Latency of writePage() (incl. retries) in milliseconds",
  buckets: [200, 500, 1000, 2000, 4000, 8000, 16000, 32000],
  registers: [promRegistry]
});

export const retrievalLatencyMs = new Histogram({
  name: "lba_retrieval_latency_ms",
  help: "Latency of retrieveRelatedPages() in milliseconds",
  buckets: [10, 25, 50, 100, 200, 500, 1000, 2000],
  registers: [promRegistry]
});

export const pdfRenderLatencyMs = new Histogram({
  name: "lba_pdf_render_latency_ms",
  help: "Latency of renderPdfV2() in milliseconds",
  buckets: [200, 500, 1000, 2000, 4000, 8000, 16000, 32000, 60000],
  registers: [promRegistry]
});

export const embeddingJobsTotal = new Counter({
  name: "lba_embedding_jobs_total",
  help: "Embedding queue jobs by terminal status",
  labelNames: ["status"] as const,
  registers: [promRegistry]
});

export const chapterSynthTotal = new Counter({
  name: "lba_chapter_synth_total",
  help: "Chapter synthesis attempts by outcome",
  labelNames: ["outcome"] as const,
  registers: [promRegistry]
});

export const validatorRepairTotal = new Counter({
  name: "lba_validator_repair_total",
  help: "validatePage repair-pass invocations by outcome",
  labelNames: ["outcome"] as const,
  registers: [promRegistry]
});

export const paywallAfterChapterShownTotal = new Counter({
  name: "lba_paywall_after_chapter_shown_total",
  help: "Number of times the after-first-chapter paywall card was shown",
  registers: [promRegistry]
});

// Convenience: time(fn) helper that records into a histogram and returns the
// callee's result. Used by hot paths like writePage / retrieveRelatedPages.
export async function time<T>(hist: Histogram, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    hist.observe(Date.now() - t0);
  }
}
