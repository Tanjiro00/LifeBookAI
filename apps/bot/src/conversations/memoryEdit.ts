import type { Context } from "grammy";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { t } from "../lib/i18n.js";
import { clearPending, getPending } from "../lib/pending.js";
import { ensureTelegramUser } from "../services/userService.js";
import { updateMemoryContent } from "../services/memoryService.js";

// Sprint 3.7 — Memory edit conversation.
//
// The user tapped «✏ <name>» on the «Я запомнил» follow-up (or in /memories).
// Their next text is the new currentSummary for that memory. We replace the
// content + append a MemoryRevision row with reason="user_edit".

const PENDING_PREFIX = "mem_edit:";

export async function applyMemoryEditFromText(ctx: Context, text: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const pending = await getPending(user.id);
  if (!pending || !pending.startsWith(PENDING_PREFIX)) {
    // Stale state — ignore.
    return;
  }
  const memoryId = pending.slice(PENDING_PREFIX.length);
  const ok = await updateMemoryContent(user.id, memoryId, text.trim());
  await clearPending(user.id);
  if (!ok) {
    await ctx.reply(t(ctx, "Эту память я уже не вижу.", "I no longer have that memory."));
    return;
  }
  logger.info(
    { event: "memory.user_edited", userId: user.id, memoryId, length: text.length },
    "memory.user_edited"
  );
  await ctx.reply(
    t(
      ctx,
      "Заменил. В книге буду опираться на твои слова.",
      "Replaced. I'll rely on your wording in the book."
    )
  );
}
