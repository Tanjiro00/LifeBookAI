import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Chapter } from "@prisma/client";
import { InputFile } from "grammy";
import { renderChapterCardPng } from "@lifebook/renderer";
import { paths, config } from "../config.js";

export async function ensureStorageDirs(): Promise<void> {
  await Promise.all([mkdir(paths.audioDir, { recursive: true }), mkdir(paths.cardsDir, { recursive: true })]);
}

export async function renderAndStoreChapterCard(chapter: Chapter, chapterNumber: number) {
  await ensureStorageDirs();
  const buffer = renderChapterCardPng({
    chapterNumber,
    title: chapter.title,
    quote: chapter.quote,
    dateRange: new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(chapter.createdAt)
  });

  const filename = `${chapter.id}.png`;
  const filePath = join(paths.cardsDir, filename);
  await writeFile(filePath, buffer);

  return {
    filePath,
    publicUrl: `${config.PUBLIC_WEB_URL.replace(/\/$/, "")}/media/cards/${filename}`,
    inputFile: new InputFile(buffer, `lifebook-${chapter.id}.png`)
  };
}

export function chapterPreviewUrl(shareToken: string): string {
  return `${config.PUBLIC_WEB_URL.replace(/\/$/, "")}/chapter/${shareToken}`;
}

