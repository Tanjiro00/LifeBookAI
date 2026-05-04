import { prisma } from "../lib/db.js";
import { renderAndStoreChapterCard } from "../services/storage.js";

export type RenderChapterCardJobData = {
  chapterId: string;
  chapterNumber: number;
};

export async function renderChapterCardJob(data: RenderChapterCardJobData) {
  const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: data.chapterId } });
  return renderAndStoreChapterCard(chapter, data.chapterNumber);
}

