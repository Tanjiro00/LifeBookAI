import { prisma } from "../lib/db.js";

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
