import type { Processor } from "bullmq";
import { Api, InlineKeyboard } from "grammy";
import type { MemoryType } from "@prisma/client";
import { reviewAndStoreMemory, type MemoryReviewResult } from "../services/memoryReviewService.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";
import { isEnglish } from "../lib/i18n.js";
import { memoryTypeLabel } from "../services/memoryService.js";
import { track } from "../services/analytics.js";
import type { MemoryMergeJob } from "./index.js";

// Sprint 3.6 — memory merge worker.
//
// Consumes MemoryMergeJob payloads enqueued from pageService AFTER the page
// has been delivered. We never block delivery on memory work — the user sees
// their page card immediately, and within a few seconds the bot follows up
// with «Я запомнил…» (Sprint 3.7).
//
// Idempotency: reviewAndStoreMemory is structurally idempotent — re-applying
// the same evidence either no-ops (changeType=confirm) or appends a duplicate
// MemoryRevision row. The latter is acceptable: revisions are append-only by
// design.

const VALID_TYPES: ReadonlyArray<MemoryType> = [
  "PERSON",
  "PLACE",
  "THEME",
  "LIFE_EVENT",
  "GOAL",
  "FEAR",
  "ACHIEVEMENT",
  "PREFERENCE"
];

function asMemoryType(value: string): MemoryType | null {
  return (VALID_TYPES as ReadonlyArray<string>).includes(value) ? (value as MemoryType) : null;
}

export const processMemoryMergeJob: Processor<MemoryMergeJob> = async (job) => {
  const { userId, pageId, language, candidates } = job.data;
  if (!candidates.length) {
    return { ok: true, processed: 0 };
  }

  const results: Array<{
    name: string;
    type: string;
    result: MemoryReviewResult["changeType"];
    memoryId: string;
  }> = [];
  for (const cand of candidates) {
    const type = asMemoryType(cand.type);
    if (!type) {
      logger.warn(
        { event: "memory.invalid_type", jobId: job.id, type: cand.type, name: cand.name, userId },
        "memory.invalid_type"
      );
      continue;
    }
    try {
      const out = await reviewAndStoreMemory({
        userId,
        type,
        rawName: cand.name,
        evidence: cand.evidence,
        pageId,
        language,
        ...(cand.category ? { category: cand.category } : {})
      });
      results.push({
        name: cand.name,
        type: cand.type,
        result: out.changeType,
        memoryId: out.memory.id
      });
    } catch (err) {
      logger.warn(
        { event: "memory.merge_failed", jobId: job.id, err: { message: (err as Error).message }, candidate: cand },
        "memory.merge_failed"
      );
    }
  }

  // Sprint 3.7 — send the «Я запомнил» follow-up directly from the worker.
  // We construct a grammY Api on the bot token (no full Bot needed for
  // outbound) and emit one short message per page summarizing what landed.
  if (results.length) {
    try {
      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramId: true, languageCode: true }
      });
      if (userRow) {
        const en = isEnglish({ languageCode: userRow.languageCode });
        const lines: string[] = [
          en ? "📌 I noted from your last page:" : "📌 Из последней страницы я запомнил:"
        ];
        for (const r of results) {
          const arrow = r.result === "created" ? "+" : r.result === "contradict" ? "≠" : "·";
          const typeLabel = memoryTypeLabel(r.type as MemoryType, en ? "en" : "ru");
          lines.push(`  ${arrow} ${typeLabel}: ${r.name}`);
        }
        lines.push(en ? "\nTap a memory below to edit or remove it." : "\nЛюбую можно поправить или удалить.");

        const kb = new InlineKeyboard();
        for (const r of results.slice(0, 6)) {
          // Two buttons per row up to 3 rows: «✏» edit (opens MemoryEntity edit
          // flow — Sprint 3.9), «🗑» delete (handled inline by callbackQuery).
          kb.text(`✏ ${r.name.slice(0, 18)}`, `mem:edit:${r.memoryId}`)
            .text("🗑", `mem:del:${r.memoryId}`)
            .row();
        }

        const api = new Api(config.TELEGRAM_BOT_TOKEN);
        await api.sendMessage(String(userRow.telegramId), lines.join("\n"), {
          reply_markup: kb
        });
        track("memory_review_sent", { userId, pageId, count: results.length });
      }
    } catch (err) {
      logger.warn(
        { event: "memory.followup_failed", jobId: job.id, err: { message: (err as Error).message } },
        "memory.followup_failed"
      );
    }
  }

  logger.info(
    { event: "memory.merge_batch_done", jobId: job.id, userId, pageId, count: results.length },
    "memory.merge_batch_done"
  );
  return { ok: true, processed: results.length, results };
};
