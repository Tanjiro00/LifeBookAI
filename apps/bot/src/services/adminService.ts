import { prisma } from "../lib/db.js";

export async function getAdminMetrics() {
  const [usersCount, activeUsersCount, savedChaptersCount, generatedChaptersCount, paymentsCount] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { onboardingDone: true } }),
    prisma.chapter.count({ where: { isSaved: true } }),
    prisma.chapter.count(),
    prisma.payment.count({ where: { status: "PAID" } })
  ]);

  return {
    usersCount,
    activeUsersCount,
    savedChaptersCount,
    generatedChaptersCount,
    paymentsCount,
    rawUserContentVisible: false
  };
}

