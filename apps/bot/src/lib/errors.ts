import type { Context } from "grammy";
import { logger } from "./logger.js";

export async function replyWithFriendlyError(ctx: Context, error: unknown): Promise<void> {
  logger.error({ err: error, userId: ctx.from?.id }, "User-facing operation failed");
  await ctx.reply(
    "Не получилось аккуратно собрать главу. Я сохранил контекст, можно попробовать ещё раз чуть позже или отправить запись заново."
  );
}

export function isSensitiveAdviceRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    "диагноз",
    "антидепрессант",
    "суицид",
    "самоубий",
    "юридическ",
    "медицинск",
    "therapy",
    "diagnosis",
    "suicide",
    "medical advice",
    "legal advice"
  ].some((marker) => lower.includes(marker));
}

