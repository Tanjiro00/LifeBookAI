import { prisma } from "../lib/db.js";
import { generateAndPersistQuestions } from "../services/chapterService.js";

export type GenerateQuestionsJobData = {
  userId: string;
  entryId: string;
};

export async function generateQuestionsJob(data: GenerateQuestionsJobData) {
  const [user, entry] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: data.userId } }),
    prisma.entry.findUniqueOrThrow({ where: { id: data.entryId } })
  ]);

  return generateAndPersistQuestions(user, entry);
}

