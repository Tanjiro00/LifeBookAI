import { logger } from "../lib/logger.js";

export type AnalyticsEvent =
  | "bot_started"
  | "onboarding_started"
  | "onboarding_completed"
  | "entry_started"
  | "text_entry_received"
  | "voice_entry_received"
  | "voice_transcribed"
  | "questions_generated"
  | "answers_received"
  | "chapter_generation_started"
  | "chapter_generated"
  | "chapter_saved"
  | "chapter_regenerated"
  | "style_adjusted"
  | "book_opened"
  | "reminder_sent"
  | "reminder_clicked"
  | "payment_started"
  | "payment_completed"
  | "paywall_shown";

export function track(event: AnalyticsEvent, payload: Record<string, unknown> = {}): void {
  logger.info({ event, ...payload }, "analytics_event");
}

