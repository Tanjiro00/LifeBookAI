import { PostHog } from "posthog-node";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

export type AnalyticsEvent =
  | "bot_started"
  | "onboarding_started"
  | "onboarding_completed"
  | "intake_started"
  | "prologue_generated"
  | "entry_started"
  | "entry_created"
  | "text_entry_received"
  | "voice_entry_received"
  | "voice_transcribed"
  // Sprint 0.5 — voice transcript confirmation flow
  | "transcript_shown"
  | "transcript_confirmed"
  | "transcript_corrected"
  // Sprint 0.1 — new delivery contract: card-only, no full body in chat
  | "page_delivered_card_only"
  | "chapter_delivered_card_only"
  // Sprint 3.7 — «Я запомнил» follow-up after memory merge.
  | "memory_review_sent"
  | "memory_edit_started"
  | "memory_deleted"
  | "memory_marked_do_not_use"
  // Sprint 3 — thread updates
  | "thread_created"
  | "thread_updated"
  | "book_opened"
  | "reminder_sent"
  | "payment_started"
  | "payment_completed"
  | "paywall_shown"
  // Misc command surfaces — pre-existing events that were tracked but never
  // declared in the union; declared here so commands typecheck.
  | "export_started"
  | "memories_opened"
  | "stats_opened"
  | "title_prompt"
  | "title_set";

// PostHog client is lazy-instantiated. When POSTHOG_API_KEY is empty we keep
// the export as undefined and `track()` skips the network call — events still
// land in pino logs so dev environments stay observable without paying.
let posthog: PostHog | undefined;
if (config.POSTHOG_API_KEY) {
  posthog = new PostHog(config.POSTHOG_API_KEY, {
    host: config.POSTHOG_HOST,
    // Flush quickly so bot restarts in container orchestration don't lose the
    // last 20s of events. The PostHog default (30s / 20 events) is fine for web
    // pages but a TG bot may sit idle then emit a burst.
    flushAt: 10,
    flushInterval: 10_000
  });
  logger.info({ host: config.POSTHOG_HOST }, "analytics.posthog_enabled");
} else {
  logger.info("analytics.posthog_disabled — set POSTHOG_API_KEY to enable");
}

export function track(event: AnalyticsEvent, payload: Record<string, unknown> = {}): void {
  logger.info({ event, ...payload }, "analytics_event");

  if (!posthog) return;

  // distinctId convention: DB User.id (cuid). Most call sites already pass
  // userId in the payload; we strip it out so PostHog can use it as identity
  // instead of duping it into properties.
  const distinctId = typeof payload.userId === "string" ? payload.userId : undefined;
  if (!distinctId) {
    // No user context (e.g. an unauthenticated webhook hit). PostHog requires
    // a distinctId; we tag these "anonymous" so they're still queryable but
    // don't pollute user-level retention reports.
    posthog.capture({
      distinctId: "anonymous",
      event,
      properties: payload
    });
    return;
  }

  const { userId: _userId, ...rest } = payload;
  posthog.capture({
    distinctId,
    event,
    properties: rest
  });
}

// Sprint analytics — call once per /start (and after onboarding completes) so
// PostHog has stable user properties for cohorting. Properties accepted:
// language, tier, telegramIdHash, createdAt, onboardingDone, etc.
export function identifyUser(userId: string, properties: Record<string, unknown>): void {
  if (!posthog) return;
  posthog.identify({ distinctId: userId, properties });
}

// Drain pending events before the process exits. Called from shutdown handler
// in apps/bot/src/index.ts. Idempotent.
export async function shutdownAnalytics(): Promise<void> {
  if (!posthog) return;
  try {
    await posthog.shutdown();
  } catch (err) {
    logger.warn({ err }, "analytics.shutdown_failed");
  }
}
