import type { Context } from "grammy";
import { InputFile } from "grammy";
import { ensureTelegramUser } from "../services/userService.js";
import { isProActive, paywallText } from "../services/subscriptions.js";
import { paywallKeyboard } from "../keyboards/settings.js";
// Sprint 5.2 — switched to PDF v2 with TOC + parts + chapter openers + epilogue.
// Legacy buildBookPdfForUser stays in bookComposer.ts as a fallback for users
// whose data hasn't migrated yet (no chapters / no current pages); v2 handles
// the modern manuscript shape.
import { buildBookPdfV2 } from "../services/bookService.js";
import { buildBookPdfForUser } from "../services/bookComposer.js";
import { logger } from "../lib/logger.js";
import { t } from "../lib/i18n.js";
import { track } from "../services/analytics.js";

export async function sendExport(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  track("export_started", { userId: user.id });

  if (!isProActive(user)) {
    await ctx.reply(paywallText(ctx, user.freeEntriesUsed), { reply_markup: paywallKeyboard(ctx) });
    return;
  }

  await ctx.reply(t(ctx, "Собираю книгу. Минута — пришлю PDF.", "Building your book. One minute — I'll send the PDF."));

  try {
    // Try v2 first; fall back to v1 if v2 fails (e.g., user has no chapters).
    let built = await buildBookPdfV2(user.id).catch((err) => {
      logger.warn({ err: { message: (err as Error).message }, userId: user.id }, "PDF v2 build failed; falling back to v1");
      return null;
    });
    if (!built) {
      built = await buildBookPdfForUser(user.id);
    }
    if (!built) {
      await ctx.reply(
        t(
          ctx,
          "Пока нечего складывать в книгу. Запиши хотя бы одну страницу.",
          "Nothing to bind yet. Send at least one entry first."
        )
      );
      return;
    }
    await ctx.replyWithDocument(new InputFile(built.filePath, "lifebook.pdf"));
  } catch (err) {
    logger.warn({ err }, "PDF build failed");
    await ctx.reply(
      t(
        ctx,
        "Не получилось собрать PDF. Попробуй ещё раз через минуту.",
        "Couldn't build the PDF. Try again in a minute."
      )
    );
  }
}
