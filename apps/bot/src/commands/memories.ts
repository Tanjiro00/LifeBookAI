import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { ensureTelegramUser } from "../services/userService.js";
import { groupByType, listMemories, memoryTypeLabel } from "../services/memoryService.js";
import { isEnglish, t } from "../lib/i18n.js";
import { track } from "../services/analytics.js";

const MAX_PER_GROUP = 8;

export async function sendMemories(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  track("memories_opened", { userId: user.id });

  const memories = await listMemories(user.id);
  if (memories.length === 0) {
    await ctx.reply(
      t(
        ctx,
        "Пока я ничего не запомнил о тебе. После 2-3 записей здесь появятся люди, места и темы, которые ты упоминаешь.",
        "I haven't remembered anything yet. After 2-3 entries you'll see people, places, and themes I picked up."
      )
    );
    return;
  }

  const language = isEnglish(ctx) ? "en" : "ru";
  const grouped = groupByType(memories);

  await ctx.reply(
    t(
      ctx,
      "Вот что я запомнил, пока писал твою книгу. Можешь удалить лишнее — это влияет на следующие страницы.",
      "Here's what I remembered while writing your book. Delete anything off-base — it shapes future pages."
    )
  );

  // Send one message per type, capped at MAX_PER_GROUP entries each. Each memory has a
  // delete inline button. Editing memory content is offered via /memories — out of scope here.
  for (const [type, items] of grouped) {
    const label = memoryTypeLabel(type, language);
    const head = `*${label}*`;
    const top = items.slice(0, MAX_PER_GROUP);

    const lines = [head];
    for (const m of top) {
      const conf = m.confidence ? ` _(${Math.round(m.confidence * 100)}%)_` : "";
      const aliases = m.aliases.length ? `\n_${escapeMd("aliases: " + m.aliases.join(", "))}_` : "";
      const sources = m.sourcePageIds.length
        ? `\n_${escapeMd(`sources: ${m.sourcePageIds.length}`)}_`
        : "";
      const dnu = m.doNotUse ? `\n_${escapeMd(t(ctx, "[не использовать]", "[do not use]"))}_` : "";
      lines.push(`\n• *${escapeMd(m.title)}*${conf}${aliases}${sources}${dnu}\n${escapeMd(m.content)}`);
    }
    if (items.length > MAX_PER_GROUP) {
      lines.push("", t(ctx, `…и ещё ${items.length - MAX_PER_GROUP}`, `…and ${items.length - MAX_PER_GROUP} more`));
    }

    // Sprint 3.7/3.9 — three actions per memory: edit, delete, or mark do-not-use.
    // We split rows so the buttons stay readable: 3 buttons × 1 row per memory,
    // up to 6 memories per chunk message.
    const kb = new InlineKeyboard();
    top.forEach((m, i) => {
      const idx = i + 1;
      kb.text(`✏ ${idx}`, `mem:edit:${m.id}`)
        .text(`🗑 ${idx}`, `mem:del:${m.id}`)
        .text(`🚫 ${idx}`, `mem:nu:${m.id}`)
        .row();
    });

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown", reply_markup: kb });
  }
}

function escapeMd(s: string): string {
  return s.replace(/([_*\[\]()`~>#+=|{}.!\\-])/g, "\\$1");
}
