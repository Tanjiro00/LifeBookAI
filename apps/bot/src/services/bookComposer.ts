import { readFile } from "node:fs/promises";
import { generateCover, nameBook } from "@lifebook/ai";
import { renderBookPdf } from "@lifebook/renderer";
import { prisma } from "../lib/db.js";
import { storeBookCoverPng, storeBookPdf } from "./storage.js";
import { logger } from "../lib/logger.js";

// First cover at entry 1 (instant visual win), refined at 3/10/25/52 as the corpus
// gets richer and themes consolidate.
export const COVER_MILESTONES = [1, 3, 10, 25, 52] as const;
const NAME_BOOK_MIN_ENTRIES = 3;

function nextCoverMilestone(entryCount: number, currentVersion: number): number | null {
  for (const milestone of COVER_MILESTONES) {
    if (entryCount >= milestone && currentVersion < milestone) return milestone;
  }
  return null;
}

export type ArtifactResult = {
  titleGenerated: boolean;
  coverGenerated: boolean;
};

// Run after every saved entry. Generates AI title + AI cover at the appropriate
// milestones. Skips title generation entirely if the user has manually set one.
// Returns metadata so the caller can notify the user about new artifacts.
export async function ensureBookArtifacts(userId: string): Promise<ArtifactResult> {
  const result: ArtifactResult = { titleGenerated: false, coverGenerated: false };

  const [book, entries] = await Promise.all([
    prisma.book.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" }
    }),
    // Cover/title milestones are based on WEEKLY pages only — the Prologue is the
    // book's foundation, not a weekly entry, and shouldn't trip the cover threshold.
    prisma.page.findMany({
      where: { userId, kind: "WEEKLY" },
      orderBy: { createdAt: "asc" },
      select: { sceneTitle: true, mood: true, tags: true }
    })
  ]);
  if (!book) return result;
  if (entries.length === 0) return result;

  const language = "ru";

  // 1) AI-suggested title at 3+ entries, unless the user has locked it in.
  if (!book.titleSetByUser && !book.aiTitle && entries.length >= NAME_BOOK_MIN_ENTRIES) {
    try {
      const named = await nameBook({
        entries: entries.map((e) => ({ title: e.sceneTitle, tags: e.tags, mood: e.mood })),
        language
      });
      await prisma.book.update({
        where: { id: book.id },
        data: { aiTitle: named.title, subtitle: book.subtitle ?? named.subtitle ?? null }
      });
      result.titleGenerated = true;
    } catch (err) {
      logger.warn({ err, bookId: book.id }, "nameBook failed");
    }
  }

  // 2) AI cover at the next milestone, if there is one.
  const fresh = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
  const milestone = nextCoverMilestone(entries.length, fresh.coverVersion);
  if (milestone !== null) {
    try {
      const themes = Array.from(new Set(entries.flatMap((e) => e.tags))).slice(0, 6);
      const mood = Array.from(new Set(entries.flatMap((e) => e.mood))).slice(0, 4);
      const titleForCover = fresh.titleSetByUser ? fresh.title : (fresh.aiTitle || fresh.title);
      const cover = await generateCover({
        bookTitle: titleForCover,
        themes,
        mood
      });
      if (cover) {
        const stored = await storeBookCoverPng(fresh.id, cover.imageBase64);
        await prisma.book.update({
          where: { id: fresh.id },
          data: { coverUrl: stored.publicUrl, coverPromptUsed: cover.promptUsed, coverVersion: milestone }
        });
        result.coverGenerated = true;
      }
    } catch (err) {
      logger.warn({ err, bookId: fresh.id }, "generateCover failed");
    }
  }

  return result;
}

// Pro-only: build a PDF book on-demand and return the local file path.
export async function buildBookPdfForUser(userId: string): Promise<{ filePath: string; publicUrl: string } | null> {
  const [user, book, entries] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.book.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.page.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })
  ]);
  if (!book || !user) return null;
  if (entries.length === 0) return null;

  let coverPng: Buffer | null = null;
  if (book.coverUrl) {
    try {
      const path = await import("node:path");
      const { paths } = await import("../config.js");
      coverPng = await readFile(path.join(paths.storageDir, "covers", `${book.id}.png`));
    } catch {
      coverPng = null;
    }
  }

  const titleForPdf = book.titleSetByUser ? book.title : (book.aiTitle || book.title);
  const buffer = await renderBookPdf({
    bookTitle: titleForPdf,
    subtitle: book.subtitle,
    authorName: user.firstName ?? undefined,
    year: new Date().getFullYear(),
    entries: entries.map((e) => ({
      title: e.sceneTitle,
      body: e.sceneContent,
      quote: e.quote,
      createdAt: e.createdAt
    })),
    coverPngBuffer: coverPng
  });

  const stored = await storeBookPdf(book.id, buffer);
  await prisma.book.update({
    where: { id: book.id },
    data: { pdfUrl: stored.publicUrl, pdfGeneratedAt: new Date() }
  });
  return stored;
}
