import { readFile } from "node:fs/promises";
import { generateCover, nameBook } from "@lifebook/ai";
import { renderBookPdf } from "@lifebook/renderer";
import { prisma } from "../lib/db.js";
import { storeBookCoverPng, storeBookPdf } from "./storage.js";
import { logger } from "../lib/logger.js";

const COVER_TRIGGER_AT_ENTRIES = 3;

// Run after every saved entry. Once the user has 3+ entries, ensure the book has an
// AI title and cover. Cheap to call repeatedly: each step early-returns if its output
// already exists.
export async function ensureBookArtifacts(userId: string): Promise<void> {
  const [book, entries] = await Promise.all([
    prisma.book.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.page.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { sceneTitle: true, mood: true, tags: true }
    })
  ]);
  if (!book) return;
  if (entries.length < COVER_TRIGGER_AT_ENTRIES) return;

  const language = "ru"; // could be derived from user.languageCode

  // Generate AI title once.
  if (!book.aiTitle) {
    try {
      const named = await nameBook({
        entries: entries.map((e) => ({ title: e.sceneTitle, tags: e.tags, mood: e.mood })),
        language
      });
      await prisma.book.update({
        where: { id: book.id },
        data: { aiTitle: named.title, subtitle: book.subtitle ?? named.subtitle ?? null }
      });
    } catch (err) {
      logger.warn({ err, bookId: book.id }, "nameBook failed");
    }
  }

  // Generate AI cover once. We re-fetch the book to pick up the freshly-set title.
  const fresh = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
  if (!fresh.coverUrl) {
    try {
      const themes = Array.from(new Set(entries.flatMap((e) => e.tags))).slice(0, 6);
      const mood = Array.from(new Set(entries.flatMap((e) => e.mood))).slice(0, 4);
      const cover = await generateCover({
        bookTitle: fresh.aiTitle || fresh.title,
        themes,
        mood
      });
      if (cover) {
        const stored = await storeBookCoverPng(fresh.id, cover.imageBase64);
        await prisma.book.update({
          where: { id: fresh.id },
          data: { coverUrl: stored.publicUrl, coverPromptUsed: cover.promptUsed }
        });
      }
    } catch (err) {
      logger.warn({ err, bookId: fresh.id }, "generateCover failed");
    }
  }
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
      // coverUrl might be a public PUBLIC_WEB_URL — we know the local path follows
      // /media/covers/<bookId>.png; load directly from disk.
      const path = await import("node:path");
      const { paths } = await import("../config.js");
      coverPng = await readFile(path.join(paths.storageDir, "covers", `${book.id}.png`));
    } catch {
      coverPng = null;
    }
  }

  const buffer = await renderBookPdf({
    bookTitle: book.aiTitle || book.title,
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
