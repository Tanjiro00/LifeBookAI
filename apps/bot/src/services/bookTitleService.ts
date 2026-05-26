import { prisma } from "../lib/db.js";

const MAX_TITLE_LENGTH = 80;

// Sets the user-chosen title on their (single) book. Locks the title so
// ensureBookArtifacts will not overwrite it with an AI suggestion later.
export async function setUserBookTitle(userId: string, rawTitle: string): Promise<{ ok: boolean; title?: string; reason?: string }> {
  const title = rawTitle.trim().replace(/\s+/g, " ");
  if (!title) return { ok: false, reason: "empty" };
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, reason: "too_long" };

  const book = await prisma.book.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!book) return { ok: false, reason: "no_book" };

  await prisma.book.update({
    where: { id: book.id },
    data: { title, titleSetByUser: true, aiTitle: null }
  });
  return { ok: true, title };
}

// Reads the canonical title for display: user-chosen wins; otherwise AI-suggested
// wins; otherwise the placeholder.
export function displayTitle(book: { title: string; aiTitle?: string | null; titleSetByUser?: boolean | null }): string {
  if (book.titleSetByUser) return book.title;
  return book.aiTitle || book.title;
}

export const TITLE_LIMITS = { max: MAX_TITLE_LENGTH };
