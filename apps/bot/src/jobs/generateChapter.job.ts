import { prisma } from "../lib/db.js";
import { generateAndPersistChapter } from "../services/chapterService.js";

export type GenerateChapterJobData = {
  userId: string;
  entryId: string;
};

export async function generateChapterJob(data: GenerateChapterJobData) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: data.userId } });
  return generateAndPersistChapter(user, data.entryId);
}

