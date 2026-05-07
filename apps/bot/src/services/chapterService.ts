import type { Page } from "@prisma/client";
import { prisma } from "../lib/db.js";

// `/delete_last` removes the user's most recent entry (page). Its raw text in Entry stays
// soft-deleted (we just unlink the Page; the Entry row is removed too via cascade).
export async function deleteLatestPage(userId: string): Promise<Page | null> {
  const page = await prisma.page.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });
  if (!page) return null;
  await prisma.page.delete({ where: { id: page.id } });
  return page;
}
