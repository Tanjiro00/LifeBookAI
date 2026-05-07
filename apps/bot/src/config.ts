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
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  FREE_CHAPTER_LIMIT: z.coerce.number().int().positive().default(3),
  ADMIN_TOKEN: z.string().optional().default(""),
  TELEGRAM_PROVIDER_TOKEN: z.string().optional().default("")
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

