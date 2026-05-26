import type { Context } from "grammy";
import { InlineKeyboard, InputFile } from "grammy";
import { t } from "../lib/i18n.js";
import { ensureTelegramUser } from "../services/userService.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { track } from "../services/analytics.js";

export async function sendPrivacy(ctx: Context): Promise<void> {
  await ctx.reply(
    t(
      ctx,
      [
        "Все записи приватны по умолчанию.",
        "",
        "Книга открывается только по твоей ссылке с длинным секретным токеном — никаких списков, поиска, или публичной ленты. Если ты никому не отправил ссылку, книгу не увидит никто.",
        "",
        "В логах не хранится сырой текст записей. Удалить запись можно через /delete_last.",
        "",
        "Команды: /export — выгрузить всё в zip; /delete_account — удалить аккаунт со всеми записями (с 7-дневной отсрочкой)."
      ].join("\n"),
      [
        "All entries are private by default.",
        "",
        "The book opens only through your link with a long secret token — no listings, no search, no public feed. If you haven't shared the link, no one sees the book.",
        "",
        "Raw entry text is never written to logs. Use /delete_last to remove your latest entry.",
        "",
        "Commands: /export — download everything as a zip; /delete_account — delete account and all entries (7-day grace period)."
      ].join("\n")
    )
  );
}

// Sprint 5.7 — /export_data. Bundles ALL user data into a JSON document and
// sends it as a Telegram document. GDPR right-to-portability — free for any
// user (Pro-gating only applies to /export which builds the PDF). The JSON
// is human-readable; a future iteration can wrap it in a real .zip with the
// cover PNG + PDF included.

export async function sendDataExport(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  track("export_started", { userId: user.id });

  await ctx.reply(t(ctx, "Собираю архив…", "Building your archive…"));

  const [pages, chapters, parts, memories, threads, books, payments] = await Promise.all([
    prisma.page.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.chapter.findMany({ where: { userId: user.id }, orderBy: { orderIndex: "asc" } }),
    prisma.bookPart.findMany({ where: { userId: user.id }, orderBy: { orderIndex: "asc" } }),
    prisma.memory.findMany({
      where: { userId: user.id },
      include: { revisions: { orderBy: { createdAt: "asc" } } }
    }),
    prisma.narrativeThread.findMany({
      where: { userId: user.id },
      include: { events: { orderBy: { createdAt: "asc" } } }
    }),
    prisma.book.findMany({ where: { userId: user.id } }),
    prisma.payment.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } })
  ]);

  const archive = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      telegramId: String(user.telegramId),
      firstName: user.firstName,
      languageCode: user.languageCode,
      writingStyle: user.writingStyle,
      styleSample: user.styleSample,
      narrativeCompass: user.narrativeCompass,
      lifeContext: user.lifeContext,
      createdAt: user.createdAt
    },
    pages,
    chapters,
    parts,
    memories,
    threads,
    books,
    payments
  };

  // Increment exportCount on the primary book (best-effort, non-fatal).
  if (books[0]) {
    await prisma.book
      .update({ where: { id: books[0].id }, data: { exportCount: { increment: 1 } } })
      .catch(() => {});
  }

  const json = JSON.stringify(archive, replacer, 2);
  const filename = `lifebook-export-${user.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
  await ctx.replyWithDocument(new InputFile(Buffer.from(json, "utf8"), filename), {
    caption: t(
      ctx,
      `Готово. ${pages.length} страниц, ${chapters.length} глав, ${memories.length} memories.`,
      `Done. ${pages.length} pages, ${chapters.length} chapters, ${memories.length} memories.`
    )
  });
  logger.info(
    {
      event: "user.export_sent",
      userId: user.id,
      pageCount: pages.length,
      chapterCount: chapters.length,
      memoryCount: memories.length,
      bytes: json.length
    },
    "user.export_sent"
  );
}

// JSON.stringify replacer for BigInt + Date safety. BigInt isn't JSON-native;
// we coerce to string so the archive stays a valid JSON document.
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return String(value);
  return value;
}

// Sprint 5.7 — /delete_account. Two-step: ask for confirmation, then mark
// deletionRequestedAt = now() so the daily hard-delete job picks it up after
// the 7-day grace period. The grace period gives the user a chance to undo
// (we expose /undo_delete to clear deletionRequestedAt).

export async function sendDeleteAccountPrompt(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  if (user.deletionRequestedAt) {
    const daysLeft = Math.max(
      0,
      7 - Math.floor((Date.now() - user.deletionRequestedAt.getTime()) / 86_400_000)
    );
    await ctx.reply(
      t(
        ctx,
        `Аккаунт уже помечен на удаление. Осталось ${daysLeft} дней до окончательного удаления. Передумал — /undo_delete.`,
        `Account is already pending deletion. ${daysLeft} days remain. Changed your mind — /undo_delete.`
      )
    );
    return;
  }
  const kb = new InlineKeyboard()
    .text(t(ctx, "🗑 Да, удалить", "🗑 Yes, delete"), "account:delete:confirm")
    .text(t(ctx, "Отменить", "Cancel"), "account:delete:abort");
  await ctx.reply(
    t(
      ctx,
      [
        "⚠️ Удалить аккаунт?",
        "",
        "После подтверждения:",
        "  · все записи, главы и память помечаются на удаление,",
        "  · 7 дней — period отсрочки (можно отменить через /undo_delete),",
        "  · через 7 дней всё удаляется без возможности восстановления.",
        "",
        "Сначала рекомендую сделать /export — выгрузить архив на свой компьютер."
      ].join("\n"),
      [
        "⚠️ Delete the account?",
        "",
        "After confirmation:",
        "  · all entries, chapters, and memories are flagged for deletion,",
        "  · 7-day grace period (cancel via /undo_delete),",
        "  · after 7 days everything is deleted unrecoverably.",
        "",
        "Please run /export first to save a copy of your archive."
      ].join("\n")
    ),
    { reply_markup: kb }
  );
}

export async function confirmDeleteAccount(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  await prisma.user.update({
    where: { id: user.id },
    data: { deletionRequestedAt: new Date() }
  });
  logger.info(
    { event: "user.deletion_requested", userId: user.id, telegramId: String(user.telegramId) },
    "user.deletion_requested"
  );
  await ctx.reply(
    t(
      ctx,
      "Аккаунт помечен на удаление. Через 7 дней всё будет стёрто. Передумал — /undo_delete.",
      "Account is now pending deletion. Everything will be erased in 7 days. Changed your mind — /undo_delete."
    )
  );
}

export async function abortDeleteAccount(ctx: Context): Promise<void> {
  await ctx.reply(t(ctx, "Хорошо, ничего не удаляю.", "Got it, nothing to delete."));
}

export async function undoDeleteAccount(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  if (!user.deletionRequestedAt) {
    await ctx.reply(
      t(
        ctx,
        "Аккаунт не на удалении — нечего отменять.",
        "Account isn't pending deletion — nothing to undo."
      )
    );
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { deletionRequestedAt: null }
  });
  logger.info({ event: "user.deletion_cancelled", userId: user.id }, "user.deletion_cancelled");
  await ctx.reply(
    t(
      ctx,
      "Удаление отменено. Аккаунт остаётся на месте.",
      "Deletion cancelled. Your account stays."
    )
  );
}
