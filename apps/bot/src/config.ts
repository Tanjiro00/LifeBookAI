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
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  FREE_CHAPTER_LIMIT: z.coerce.number().int().positive().default(3),
  ADMIN_TOKEN: z.string().optional().default(""),
  TELEGRAM_PROVIDER_TOKEN: z.string().optional().default("")
});

export const config = ConfigSchema.parse(process.env);

export const paths = {
  storageDir: resolve(process.cwd(), config.LOCAL_STORAGE_DIR),
  audioDir: resolve(process.cwd(), config.LOCAL_STORAGE_DIR, "audio"),
  cardsDir: resolve(process.cwd(), config.LOCAL_STORAGE_DIR, "cards")
};

