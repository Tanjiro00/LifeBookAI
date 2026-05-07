import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@prisma/client";
import { InputFile } from "grammy";
import { renderEntryCardPng } from "@lifebook/renderer";
import { paths, config } from "../config.js";

export async function ensureStorageDirs(): Promise<void> {
  await Promise.all([
    mkdir(paths.audioDir, { recursive: true }),
    mkdir(paths.cardsDir, { recursive: true }),
    mkdir(join(paths.storageDir, "covers"), { recursive: true }),
    mkdir(join(paths.storageDir, "books"), { recursive: true }),
    mkdir(join(paths.storageDir, "samples"), { recursive: true })
  ]);
}

// A hand-crafted sample entry card sent on /start to show new users what their week
// becomes. The content is intentionally universal — anyone can recognize themselves
// in "a sentence I started writing and didn't finish".
const SAMPLE_ENTRY = {
  entryNumber: 14,
  totalSlots: 52,
  title: "Письмо, которое я не отправил",
  body: [
    "В среду перед сном я начал писать длинное сообщение — кому, я уже забыл. Про то, что неделя была странная, что я устал, про что-то, что давно хотел сказать. Не отправил. Утром перечитал, удалил.",
    "Но что-то осталось: не текст, а то, что я остановился посреди обычной недели и попытался её услышать. Раньше я бы прошёл мимо."
  ].join("\n\n"),
  quote: "Иногда главное — не отправить, а написать.",
  mood: ["quiet"] as const,
  tags: ["неделя"] as const
};

let sampleCardPath: string | null = null;
export async function getSampleEntryCardPath(): Promise<string> {
  if (sampleCardPath) return sampleCardPath;
  await ensureStorageDirs();
  const filePath = join(paths.storageDir, "samples", "entry-sample.png");
  const buffer = renderEntryCardPng({
    entryNumber: SAMPLE_ENTRY.entryNumber,
    totalSlots: SAMPLE_ENTRY.totalSlots,
    title: SAMPLE_ENTRY.title,
    body: SAMPLE_ENTRY.body,
    quote: SAMPLE_ENTRY.quote,
    mood: [...SAMPLE_ENTRY.mood],
    tags: [...SAMPLE_ENTRY.tags],
    createdAt: new Date()
  });
  await writeFile(filePath, buffer);
  sampleCardPath = filePath;
  return filePath;
}

export async function renderAndStoreEntryCard(page: Page, totalSlots = 52) {
  await ensureStorageDirs();
  const buffer = renderEntryCardPng({
    entryNumber: await entryNumberFor(page),
    totalSlots,
    title: page.sceneTitle,
    body: page.sceneContent,
    quote: page.quote,
    mood: page.mood,
    tags: page.tags,
    createdAt: page.createdAt
  });
  const filename = `entry-${page.id}.png`;
  const filePath = join(paths.cardsDir, filename);
  await writeFile(filePath, buffer);
  return {
    filePath,
    publicUrl: `${config.MEDIA_BASE_URL.replace(/\/$/, "")}/media/cards/${filename}`,
    inputFile: new InputFile(buffer, `lifebook-entry-${page.id}.png`)
  };
}

// Helper that takes a page and resolves its entry-number — used by the card renderer
// when it isn't given one. We compute by counting earlier pages by createdAt.
async function entryNumberFor(page: Page): Promise<number> {
  // Avoid extra queries when caller supplied number-aware path; fallback to page count via DB.
  const { prisma } = await import("../lib/db.js");
  return prisma.page.count({
    where: { userId: page.userId, createdAt: { lte: page.createdAt } }
  });
}

export async function storeBookCoverPng(bookId: string, base64: string): Promise<{ publicUrl: string; filePath: string }> {
  await ensureStorageDirs();
  const filename = `${bookId}.png`;
  const filePath = join(paths.storageDir, "covers", filename);
  await writeFile(filePath, Buffer.from(base64, "base64"));
  return {
    filePath,
    publicUrl: `${config.MEDIA_BASE_URL.replace(/\/$/, "")}/media/covers/${filename}`
  };
}

export async function storeBookPdf(bookId: string, buffer: Buffer): Promise<{ publicUrl: string; filePath: string }> {
  await ensureStorageDirs();
  const filename = `${bookId}.pdf`;
  const filePath = join(paths.storageDir, "books", filename);
  await writeFile(filePath, buffer);
  return {
    filePath,
    publicUrl: `${config.MEDIA_BASE_URL.replace(/\/$/, "")}/media/books/${filename}`
  };
}

export function pagePreviewUrl(shareToken: string): string {
  // Kept for legacy share-tokens that may exist in old data; new flow uses /book only.
  return `${config.PUBLIC_WEB_URL.replace(/\/$/, "")}/page/${shareToken}`;
}

export function bookPreviewUrl(shareToken: string): string {
  return `${config.PUBLIC_WEB_URL.replace(/\/$/, "")}/book/${shareToken}`;
}
