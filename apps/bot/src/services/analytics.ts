import { logger } from "../lib/logger.js";

export type AnalyticsEvent =
  | "bot_started"
  | "onboarding_started"
  | "onboarding_completed"
  | "entry_started"
  | "entry_created"
  | "text_entry_received"
  | "voice_entry_received"
  | "voice_transcribed"
  | "book_opened"
  | "reminder_sent"
  | "payment_started"
  | "payment_completed"
  | "paywall_shown";

export function track(event: AnalyticsEvent, payload: Record<string, unknown> = {}): void {
  logger.info({ event, ...payload }, "analytics_event");
}
