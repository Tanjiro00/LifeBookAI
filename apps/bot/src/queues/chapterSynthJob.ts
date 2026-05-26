import type { Processor } from "bullmq";
import { Api } from "grammy";
import { synthesizeChapterForUser } from "../services/chapterService.js";
import { deliverChapterByApi } from "../services/pageDeliveryService.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";
import { track } from "../services/analytics.js";
import type { ChapterSynthJob } from "./index.js";

// Sprint 4.6 — chapter synthesis worker.
//
// Coalesce: queues/index.ts adds the job with jobId=`synth:${userId}` so per-user
// only one synth runs at a time; further enqueues during an in-flight run are
// dropped. After a successful synth we deliver the chapter card via
// deliverChapterByApi — same contract as the in-handler path: ONE photo,
// caption ≤ 1024, 4 inline buttons.

export const processChapterSynthJob: Processor<ChapterSynthJob> = async (job) => {
  const { userId } = job.data;
  const result = await synthesizeChapterForUser(userId);

  if (result.status === "skipped") {
    logger.info(
      { event: "chapter.job_skipped", jobId: job.id, userId, reason: result.reason },
      "chapter.job_skipped"
    );
    return { ok: true, status: "skipped", reason: result.reason };
  }

  // Deliver the chapter card.
  try {
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true, languageCode: true }
    });
    if (!userRow) {
      return { ok: true, status: "created", delivered: false, reason: "user_not_found" };
    }
    const api = new Api(config.TELEGRAM_BOT_TOKEN);
    const language: "ru" | "en" = (userRow.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";

    // Compute pageRange: 1-based, where the count is over current WEEKLY pages
    // of THIS user up to and including the chapter's last linked page.
    const linkedPages = await prisma.page.findMany({
      where: { chapterId: result.chapter.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true }
    });
    const totalWeeklyByEnd = linkedPages.length
      ? await prisma.page.count({
          where: {
            userId,
            kind: "WEEKLY",
            isCurrent: true,
            createdAt: { lte: linkedPages[linkedPages.length - 1]!.createdAt }
          }
        })
      : 0;
    const pageRange = linkedPages.length
      ? { from: Math.max(1, totalWeeklyByEnd - linkedPages.length + 1), to: totalWeeklyByEnd }
      : null;

    const book = await prisma.book.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { shareToken: true }
    });

    await deliverChapterByApi({
      api,
      chatId: String(userRow.telegramId),
      language,
      input: {
        chapter: result.chapter,
        biographerNote: result.chapter.intro ?? result.chapter.summary ?? result.chapter.title,
        pageIds: linkedPages.map((p) => p.id),
        bookShareToken: book?.shareToken ?? null,
        pageRange
      }
    });

    track("chapter_delivered_card_only", {
      userId,
      chapterId: result.chapter.id,
      pageCount: linkedPages.length
    });

    logger.info(
      {
        event: "chapter.job_delivered",
        jobId: job.id,
        userId,
        chapterId: result.chapter.id,
        title: result.chapter.title
      },
      "chapter.job_delivered"
    );
    return { ok: true, status: "created", delivered: true, chapterId: result.chapter.id };
  } catch (err) {
    logger.warn(
      {
        event: "chapter.delivery_failed",
        jobId: job.id,
        userId,
        chapterId: result.chapter.id,
        err: { message: (err as Error).message }
      },
      "chapter.delivery_failed"
    );
    return { ok: false, status: "created", delivered: false };
  }
};
