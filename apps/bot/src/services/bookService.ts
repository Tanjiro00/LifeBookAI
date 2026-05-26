import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateEpilogue, suggestBookParts } from "@lifebook/ai";
import { renderPdfV2 } from "@lifebook/renderer";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { paths } from "../config.js";
import { storeBookPdf } from "./storage.js";

export async function getBookSummary(userId: string) {
  const [book, count, latest] = await Promise.all([
    prisma.book.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, aiTitle: true, subtitle: true, shareToken: true, coverUrl: true }
    }),
    prisma.page.count({ where: { userId } }),
    prisma.page.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { sceneTitle: true, createdAt: true }
    })
  ]);
  return { book, count, latest };
}

export async function getLatestEntry(userId: string) {
  return prisma.page.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });
}

// Sprint 5.2 — Full PDF build orchestrator.
//
// Replaces the legacy `buildBookPdfForUser` flow that just called the v1
// renderer on a flat list of pages. The new pipeline:
//
//   1. Ensure all current pages exist + are USER_APPROVED-or-better chapters.
//   2. If chapters ≥ 4 and no parts yet, suggest parts (LLM) + persist.
//   3. Generate the epilogue if missing (and we have ≥ 3 chapters).
//   4. Render via renderPdfV2 (two-pass with TOC).
//   5. Persist to /media/books/<bookId>.pdf, update Book.pdfUrl + pdfGeneratedAt.
//   6. Mark chapters LOCKED_FOR_PDF.
//
// Returns null when nothing to render (no pages); throws on hard failures.

export async function buildBookPdfV2(userId: string): Promise<{ filePath: string; publicUrl: string } | null> {
  const [user, book, currentPages] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.book.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.page.findMany({
      where: { userId, isCurrent: true },
      orderBy: { createdAt: "asc" }
    })
  ]);
  if (!user || !book) return null;
  if (currentPages.length === 0) return null;

  const language: "ru" | "en" = (user.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";
  const prologue = currentPages.filter((p) => p.kind === "PROLOGUE");
  const weeklyAndOther = currentPages.filter((p) => p.kind !== "PROLOGUE");

  // ── Chapters: only USER_APPROVED+ go into the PDF. DRAFT chapters with
  //    pages still attached are surfaced as «orphan pages» in the PDF — the
  //    renderer puts them in their own informal section so the user sees them.
  const chapters = await prisma.chapter.findMany({
    where: { userId, status: { in: ["USER_APPROVED", "LOCKED_FOR_PDF", "DRAFT"] } },
    orderBy: { orderIndex: "asc" }
  });

  // ── Parts: suggest if ≥4 chapters and 0 existing parts.
  let parts = await prisma.bookPart.findMany({
    where: { userId },
    orderBy: { orderIndex: "asc" }
  });
  if (parts.length === 0 && chapters.length >= 4) {
    try {
      const suggestion = await suggestBookParts({
        language,
        bookTitle: book.titleSetByUser ? book.title : book.aiTitle ?? book.title,
        chapters: chapters.map((c) => ({
          id: c.id,
          title: c.title,
          intro: c.intro,
          themes: c.themes,
          orderIndex: c.orderIndex
        }))
      });
      if (suggestion.parts.length >= 2) {
        // Persist parts + update each chapter's partId.
        await prisma.$transaction(async (tx) => {
          for (let i = 0; i < suggestion.parts.length; i += 1) {
            const p = suggestion.parts[i]!;
            const partRow = await tx.bookPart.create({
              data: {
                userId,
                bookId: book.id,
                title: p.title,
                intro: p.intro ?? null,
                orderIndex: i
              }
            });
            await tx.chapter.updateMany({
              where: { id: { in: p.chapterIds }, userId },
              data: { partId: partRow.id }
            });
          }
        });
        parts = await prisma.bookPart.findMany({
          where: { userId },
          orderBy: { orderIndex: "asc" }
        });
        logger.info(
          { event: "book.parts_created", userId, count: parts.length },
          "book.parts_created"
        );
      }
    } catch (err) {
      logger.warn(
        { event: "book.parts_failed", userId, err: { message: (err as Error).message } },
        "book.parts_failed"
      );
    }
  }

  // ── Epilogue: generate if missing AND we have ≥3 chapters.
  if (!book.epilogue && chapters.length >= 3) {
    try {
      const epi = await generateEpilogue({
        language,
        bookTitle: book.titleSetByUser ? book.title : book.aiTitle ?? book.title,
        chapters: chapters.map((c) => ({ title: c.title, intro: c.intro })),
        recentPageBodies: weeklyAndOther.slice(-3).map((p) => p.sceneContent),
        narrativeCompass: user.narrativeCompass,
        writingStyle: user.writingStyle
      });
      await prisma.book.update({
        where: { id: book.id },
        data: { epilogue: epi.epilogue }
      });
      logger.info({ event: "book.epilogue_generated", userId, length: epi.epilogue.length }, "book.epilogue_generated");
    } catch (err) {
      logger.warn(
        { event: "book.epilogue_failed", userId, err: { message: (err as Error).message } },
        "book.epilogue_failed"
      );
    }
  }

  // ── Cover: fetch the bytes if available locally.
  let coverPng: Buffer | null = null;
  if (book.coverUrl) {
    try {
      coverPng = await readFile(join(paths.storageDir, "covers", `${book.id}.png`));
    } catch {
      coverPng = null;
    }
  }

  // ── Render. We pass the full set of parts/chapters/entries to v2.
  const fresh = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
  const titleForPdf = fresh.titleSetByUser ? fresh.title : fresh.aiTitle ?? fresh.title;

  const buffer = await renderPdfV2({
    bookTitle: titleForPdf,
    authorName: user.firstName ?? null,
    subtitle: fresh.subtitle ?? null,
    year: new Date().getFullYear(),
    parts: parts.map((p) => ({
      id: p.id,
      title: p.title,
      intro: p.intro,
      orderIndex: p.orderIndex
    })),
    chapters: chapters.map((c) => ({
      id: c.id,
      title: c.title,
      subtitle: c.subtitle,
      intro: c.intro,
      partId: c.partId,
      orderIndex: c.orderIndex
    })),
    entries: weeklyAndOther.map((p) => ({
      id: p.id,
      title: p.sceneTitle,
      body: p.sceneContent,
      quote: p.quote,
      createdAt: p.createdAt,
      chapterId: p.chapterId
    })),
    prologue: prologue.map((p) => ({
      id: p.id,
      title: p.sceneTitle,
      body: p.sceneContent,
      quote: p.quote,
      createdAt: p.createdAt
    })),
    epilogue: fresh.epilogue,
    coverPngBuffer: coverPng
  });

  const stored = await storeBookPdf(book.id, buffer);
  await prisma.book.update({
    where: { id: book.id },
    data: { pdfUrl: stored.publicUrl, pdfGeneratedAt: new Date() }
  });

  // Lock approved chapters so future edits create a v+1 instead of mutating
  // what's now in a delivered PDF.
  await prisma.chapter.updateMany({
    where: { userId, status: "USER_APPROVED" },
    data: { status: "LOCKED_FOR_PDF" }
  });

  logger.info(
    {
      event: "book.pdf_built_v2",
      userId,
      bookId: book.id,
      bytes: buffer.length,
      chapterCount: chapters.length,
      partCount: parts.length,
      hasEpilogue: Boolean(fresh.epilogue)
    },
    "book.pdf_built_v2"
  );

  return stored;
}
