import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../apps/bot/src/lib/db.js";
import { generateShareToken } from "../apps/bot/src/services/pageService.js";
import { synthesizeChapterForUser } from "../apps/bot/src/services/chapterService.js";
import { buildBookPdfV2 } from "../apps/bot/src/services/bookService.js";
import {
  isPrologueRefreshEligible,
  refreshUserPrologue
} from "../apps/bot/src/services/prologueRefreshService.js";
import { processStyleAuditJob } from "../apps/bot/src/queues/styleAuditJob.js";
import type { Job } from "bullmq";

// Sprint 5 end-to-end smoke. Drives:
//   - Seed user + 9 weekly pages + 5 prologue pages.
//   - Run synthesizeChapterForUser twice → 2 chapters.
//   - Build PDF via buildBookPdfV2 → assert non-empty bytes + magic.
//   - Trigger prologue refresh → assert v+1 chain.
//   - Trigger styleAudit job → assert User.styleRecalibration filled when banned word present.
//   - Soft-delete: set deletionRequestedAt, undo, confirm.

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run this smoke script.");
  }

  console.log("[smoke5] creating user…");
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt(940_000_000_000 + Math.floor(Math.random() * 1_000_000)),
      languageCode: "ru",
      firstName: "Smoke5",
      onboardingDone: true,
      writingStyle: "Calm, restrained",
      styleSample: "На кухне было тихо. Я заварил кофе и стоял у окна.",
      narrativeCompass: "Год тишины"
    }
  });
  await prisma.book.create({
    data: { userId: user.id, title: "Smoke 5 Book", shareToken: generateShareToken(), aiTitle: "Год кухни" }
  });
  console.log("[smoke5] user:", user.id);

  // Seed prologue (5 pages) and 9 weekly pages.
  for (let i = 0; i < 5; i += 1) {
    const e = await prisma.entry.create({
      data: { userId: user.id, rawText: `prologue ${i + 1}`, finalInputText: `prologue ${i + 1}`, transcriptConfirmed: true, status: "SAVED" }
    });
    await prisma.page.create({
      data: {
        userId: user.id,
        entryId: e.id,
        sceneTitle: `Пролог ${i + 1}`,
        sceneContent: `Пролог-страница ${i + 1}: первое утро на новой кухне, тихо и ясно.`,
        biographerNote: "",
        kind: "PROLOGUE",
        shareToken: generateShareToken(),
        isCurrent: true,
        version: 1,
        tags: ["пролог"]
      }
    });
  }
  // Weekly pages: half mention banned SaaS word "трансформация" so styleAudit
  // mock can detect drift.
  for (let i = 0; i < 9; i += 1) {
    const seed =
      i < 4
        ? `Тихая неделя ${i + 1}: пил кофе у окна.`
        : `Неделя ${i + 1}: настоящая трансформация, journey continues.`;
    const e = await prisma.entry.create({
      data: { userId: user.id, rawText: seed, finalInputText: seed, transcriptConfirmed: true, status: "SAVED" }
    });
    await prisma.page.create({
      data: {
        userId: user.id,
        entryId: e.id,
        sceneTitle: `Неделя ${i + 1}`,
        sceneContent: seed + " " + seed,
        biographerNote: "",
        kind: "WEEKLY",
        shareToken: generateShareToken(),
        isCurrent: true,
        version: 1,
        tags: ["кухня"]
      }
    });
  }
  const totalPages = await prisma.page.count({ where: { userId: user.id, isCurrent: true } });
  console.log(`[smoke5] seeded ${totalPages} current pages (5 prologue + 9 weekly)`);

  // ─── Chapter synthesis × 2 ─────────────────────────────────────────────
  console.log("\n[smoke5] synthesizing chapters…");
  const r1 = await synthesizeChapterForUser(user.id);
  if (r1.status !== "created") throw new Error(`expected first chapter created, got ${r1.status}`);
  console.log(`  → chapter 1: "${r1.chapter.title}" (${r1.chapter.orderIndex})`);
  // Mark approved so PDF includes it.
  await prisma.chapter.update({ where: { id: r1.chapter.id }, data: { status: "USER_APPROVED" } });

  const r2 = await synthesizeChapterForUser(user.id);
  if (r2.status !== "created") {
    console.log(`  → chapter 2 skipped (${r2.reason}) — only ${await prisma.page.count({ where: { userId: user.id, kind: "WEEKLY", chapterId: null, isCurrent: true } })} unchaptered pages remain`);
  } else {
    console.log(`  → chapter 2: "${r2.chapter.title}" (${r2.chapter.orderIndex})`);
    await prisma.chapter.update({ where: { id: r2.chapter.id }, data: { status: "USER_APPROVED" } });
  }

  // ─── PDF v2 build ──────────────────────────────────────────────────────
  console.log("\n[smoke5] building PDF v2…");
  const built = await buildBookPdfV2(user.id);
  if (!built) throw new Error("PDF build returned null");
  console.log(`  → PDF: ${built.publicUrl}`);
  // Sanity: read the file bytes and check PDF magic %PDF.
  const fs = await import("node:fs/promises");
  const bytes = await fs.readFile(built.filePath);
  console.log(`  → bytes=${bytes.length}, magic="${bytes.slice(0, 4).toString("ascii")}"`);
  if (bytes.length < 5000) throw new Error("PDF suspiciously small");
  if (bytes.slice(0, 4).toString("ascii") !== "%PDF") throw new Error("PDF magic missing");
  // Save for manual inspection.
  writeFileSync("/tmp/smoke5-book.pdf", bytes);
  console.log("  → copied to /tmp/smoke5-book.pdf for inspection");

  // ─── Prologue refresh ──────────────────────────────────────────────────
  console.log("\n[smoke5] checking prologue refresh eligibility…");
  const elig = await isPrologueRefreshEligible(user.id);
  console.log("  →", elig);
  if (!elig.eligible) throw new Error(`prologue refresh should be eligible (got ${elig.reason})`);
  const refreshed = await refreshUserPrologue(user);
  console.log(`  → refreshed ${refreshed.refreshed} prologue pages, new ids=${refreshed.newPageIds.slice(0, 3).map((id) => id.slice(0, 8)).join(",")}…`);
  // Verify v+1 chain integrity.
  const prologue = await prisma.page.findMany({ where: { userId: user.id, kind: "PROLOGUE" }, orderBy: [{ revisionOfId: "asc" }, { version: "asc" }] });
  const currentCount = prologue.filter((p) => p.isCurrent).length;
  console.log(`  → prologue rows=${prologue.length}, current=${currentCount}`);
  if (currentCount !== 5) throw new Error(`expected exactly 5 current prologue pages, got ${currentCount}`);

  // ─── Style audit ──────────────────────────────────────────────────────
  console.log("\n[smoke5] running styleAudit job…");
  const fakeJob = { id: "smoke5-audit", data: { userId: user.id }, queueName: "lifebook.style_audit", name: "audit", attemptsMade: 0 } as unknown as Job;
  const auditResult = await (processStyleAuditJob as unknown as (j: Job) => Promise<unknown>)(fakeJob);
  console.log("  →", auditResult);
  const userAfter = await prisma.user.findUnique({
    where: { id: user.id },
    select: { styleRecalibration: true }
  });
  console.log(`  → User.styleRecalibration: "${(userAfter?.styleRecalibration ?? "null").slice(0, 80)}"`);
  if (!userAfter?.styleRecalibration) {
    throw new Error("styleAudit should detect drift on banned-word weekly pages");
  }

  // ─── Delete-account flow ──────────────────────────────────────────────
  console.log("\n[smoke5] testing soft-delete + undo…");
  await prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: new Date() } });
  const flagged = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionRequestedAt: true } });
  console.log(`  → deletionRequestedAt set: ${flagged?.deletionRequestedAt?.toISOString()}`);
  await prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: null } });
  const cleared = await prisma.user.findUnique({ where: { id: user.id }, select: { deletionRequestedAt: true } });
  console.log(`  → undo cleared: ${cleared?.deletionRequestedAt}`);
  if (cleared?.deletionRequestedAt !== null) throw new Error("undo failed");

  // ─── Cleanup ───────────────────────────────────────────────────────────
  console.log("\n[smoke5] cleaning up…");
  await prisma.user.delete({ where: { id: user.id } });
  console.log("[smoke5] done.");
}

main()
  .catch((e) => {
    console.error("[smoke5] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
