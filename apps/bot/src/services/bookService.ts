import { prisma } from "../lib/db.js";

export async function getBookSummary(userId: string) {
  const [book, savedChapters] = await Promise.all([
    prisma.book.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.chapter.findMany({
      where: { userId, isSaved: true },
      orderBy: { createdAt: "desc" },
      take: 7,
      select: {
        id: true,
        title: true,
        shareToken: true,
        createdAt: true
      }
    })
  ]);

  const count = await prisma.chapter.count({ where: { userId, isSaved: true } });
  const first = savedChapters.at(-1)?.createdAt;
  const last = savedChapters.at(0)?.createdAt;

  return {
    book,
    savedChapters,
    count,
    periodStart: first,
    periodEnd: last
  };
}

export async function getLatestSavedChapter(userId: string) {
  return prisma.chapter.findFirst({
    where: { userId, isSaved: true },
    orderBy: { createdAt: "desc" }
  });
}

