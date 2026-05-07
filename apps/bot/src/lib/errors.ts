import { UserState } from "@prisma/client";
import type { Context } from "grammy";
import { logger } from "./logger.js";
import { prisma } from "./db.js";

function safeError(error: unknown): { name?: string; message?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

export async function replyWithFriendlyError(ctx: Context, error: unknown): Promise<void> {
  // Log only safe metadata; raw user content lives in DB, never in error logs.
  logger.error({ err: safeError(error), userId: ctx.from?.id }, "User-facing operation failed");

  // Reset state so the user is not stuck in TRANSCRIBING / GENERATING after a failure.
  if (ctx.from) {
    try {
      const telegramId = BigInt(ctx.from.id);
      const user = await prisma.user.findUnique({ where: { telegramId } });
      if (user && user.state !== UserState.READY) {
        await prisma.user.update({
          where: { id: user.id },
          data: { state: UserState.READY }
        });
      }
    } catch (innerError) {
      logger.warn({ err: safeError(innerError) }, "Failed to reset user state after error");
    }
  }

  await ctx.reply(
    [
      "Не получилось аккуратно собрать главу.",
      "",
      "Это не из-за тебя — попробуй прислать запись ещё раз через минуту, или нажми /new и начни заново. Я ничего не теряю."
    ].join("\n")
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
