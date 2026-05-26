import type { Processor } from "bullmq";
import { auditStyle } from "@lifebook/ai";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import type { StyleAuditJob } from "./index.js";

// Sprint 5.4 — Style auditor worker.
//
// Enqueued from pageService every 5 weekly pages (jobId-coalesced per user so
// rapid bursts don't spam the auditor). Reads the user's last 5 page bodies,
// asks auditStyle for a recalibration note, persists it on User.styleRecalibration.
// The writer prompt picks it up on the next page generation via
// buildNarrativeContext (already wired in Sprint 1.5).
//
// Idempotent: re-running just produces a fresh note; we always overwrite.

export const processStyleAuditJob: Processor<StyleAuditJob> = async (job) => {
  const { userId } = job.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      languageCode: true,
      writingStyle: true,
      styleSample: true
    }
  });
  if (!user) {
    return { ok: true, status: "skipped", reason: "user_not_found" };
  }

  const recent = await prisma.page.findMany({
    where: { userId, kind: "WEEKLY", isCurrent: true },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { sceneContent: true }
  });
  if (recent.length < 2) {
    return { ok: true, status: "skipped", reason: "not_enough_pages" };
  }

  const language = (user.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";
  const result = await auditStyle({
    language,
    writingStyle: user.writingStyle,
    styleSample: user.styleSample,
    recentBodies: recent.map((r) => r.sceneContent).reverse()
  });

  await prisma.user.update({
    where: { id: userId },
    data: { styleRecalibration: result.recalibration }
  });
  logger.info(
    {
      event: "style.audit_done",
      jobId: job.id,
      userId,
      driftScore: result.driftScore,
      hadNote: result.recalibration !== null
    },
    "style.audit_done"
  );
  return { ok: true, status: "done", driftScore: result.driftScore };
};
