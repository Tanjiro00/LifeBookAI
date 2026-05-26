import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";

// Sprint 5.7 — Hard-delete worker.
//
// Runs on a periodic timer in-process (every hour). Finds users whose
// deletionRequestedAt is more than 7 days old and hard-deletes them. Cascade
// deletes (User onDelete: Cascade) handle Entry, Page, Chapter, Memory,
// Payment, NarrativeThread, BookPart, PageEmbedding.
//
// We log each deletion at info level so the operator can audit. The job is
// idempotent: a re-run sees no rows past the cutoff (since they're gone).

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export async function runHardDeleteSweep(now = new Date()): Promise<{ deletedUserIds: string[] }> {
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_MS);
  const due = await prisma.user.findMany({
    where: { deletionRequestedAt: { lte: cutoff } },
    select: { id: true, telegramId: true, deletionRequestedAt: true }
  });
  const deletedUserIds: string[] = [];
  for (const u of due) {
    try {
      await prisma.user.delete({ where: { id: u.id } });
      deletedUserIds.push(u.id);
      logger.info(
        {
          event: "user.hard_deleted",
          userId: u.id,
          telegramId: String(u.telegramId),
          requestedAt: u.deletionRequestedAt?.toISOString()
        },
        "user.hard_deleted"
      );
    } catch (err) {
      logger.warn(
        { event: "user.hard_delete_failed", userId: u.id, err: { message: (err as Error).message } },
        "user.hard_delete_failed"
      );
    }
  }
  return { deletedUserIds };
}

export function startHardDeleteLoop(): NodeJS.Timeout {
  // Fire one immediately on startup, then every hour. Errors are absorbed —
  // the loop never lets one bad sweep stop subsequent sweeps.
  void runHardDeleteSweep().catch((err) =>
    logger.error({ err }, "Initial hard-delete sweep failed")
  );
  return setInterval(() => {
    void runHardDeleteSweep().catch((err) =>
      logger.error({ err }, "Hard-delete sweep failed")
    );
  }, TICK_INTERVAL_MS);
}
