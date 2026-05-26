import "dotenv/config";
import { resolve } from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  PORT: z.coerce.number().int().positive().default(8080),
  BOT_MODE: z.enum(["polling", "webhook"]).default("polling"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(""),
  BOT_WEBHOOK_URL: z.string().url().optional().or(z.literal("")).default(""),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),
  // The base under which /media/* is served. In production this is usually the same
  // host as the web preview; in dev the bot's own port serves /media.
  MEDIA_BASE_URL: z.string().url().optional().or(z.literal("")).default(""),
  // The base URL for the Telegram Mini App. Falls back to PUBLIC_WEB_URL when
  // empty so local dev keeps working without an extra env var. In production this
  // points at the standalone Mini App build (separate from the public web preview)
  // so we can ship Mini-App-only auth + UI without affecting public share links.
  MINIAPP_URL: z.string().url().optional().or(z.literal("")).default(""),
  // Sprint 4 — JWT secret for Mini App auth. Required only when the Mini App auth
  // route is wired up (Sprint 4); kept optional here so Sprint 0 can ship.
  MINIAPP_JWT_SECRET: z.string().optional().default(""),
  MINIAPP_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  // Background-worker switch: when true the bot process also boots BullMQ workers.
  // In larger deployments you can run a dedicated worker process with WORKER_ENABLED=true
  // and the bot with WORKER_ENABLED=false.
  WORKER_ENABLED: z
    .preprocess((v) => (typeof v === "string" ? v.toLowerCase() === "true" : v), z.boolean())
    .default(true),
  // Sprint 0 caps. FREE_PAGE_LIMIT is the new free-tier cap (8) — replaces the old
  // hard-coded FREE_ENTRY_LIMIT in subscriptions.ts.
  FREE_PAGE_LIMIT: z.coerce.number().int().positive().default(8),
  TELEGRAM_CAPTION_MAX: z.coerce.number().int().positive().default(1024),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  // OpenAI / AI provider
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  // Sprint 1+ models. Defaults are reasonable but can be overridden per env.
  // Planner is cheap (small JSON), validator is cheap; writer is the main spend.
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  OPENAI_PLANNER_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_WRITER_MODEL: z.string().default("gpt-4.1"),
  OPENAI_VALIDATOR_MODEL: z.string().default("gpt-4.1-mini"),
  // Kept as a no-op env var for backwards compatibility with existing .env
  // files. The service is OpenAI-only — there is no mock provider anymore.
  // Any value is accepted and ignored; the bot always hits OpenAI.
  AI_PROVIDER: z.string().optional().default("openai"),
  // Product
  FREE_CHAPTER_LIMIT: z.coerce.number().int().positive().default(3),
  FOLLOWUP_QUESTIONS_ENABLED: z
    .preprocess((v) => (typeof v === "string" ? v.toLowerCase() === "true" : v), z.boolean())
    .default(true),
  FOLLOWUP_QUESTIONS_COUNT: z.coerce.number().int().min(0).max(3).default(2),
  ADMIN_TOKEN: z.string().optional().default(""),
  TELEGRAM_PROVIDER_TOKEN: z.string().optional().default(""),
  // Encryption (at-rest, optional for v1.0 — guarded by ENCRYPTION_KEY presence)
  ENCRYPTION_KEY: z.string().optional().default(""),
  // Observability
  SENTRY_DSN: z.string().optional().default(""),
  // Product analytics — PostHog Cloud. Leave POSTHOG_API_KEY empty to keep
  // events local (pino logger only); set it and events also fan out to PostHog.
  POSTHOG_API_KEY: z.string().optional().default(""),
  POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com")
});

const _parsed = ConfigSchema.parse(process.env);
// Fall back: if no explicit media base is set, serve /media off the bot's own port.
const mediaBaseUrl = _parsed.MEDIA_BASE_URL || `http://localhost:${_parsed.PORT}`;
export const config = { ..._parsed, MEDIA_BASE_URL: mediaBaseUrl };

export const paths = {
  storageDir: resolve(process.cwd(), config.LOCAL_STORAGE_DIR),
  audioDir: resolve(process.cwd(), config.LOCAL_STORAGE_DIR, "audio"),
  cardsDir: resolve(process.cwd(), config.LOCAL_STORAGE_DIR, "cards")
};
