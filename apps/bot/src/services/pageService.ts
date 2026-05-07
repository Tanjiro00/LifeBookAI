import { randomBytes } from "node:crypto";
import { EntryStatus, MemoryType, type Entry, type Page, type User } from "@prisma/client";
import { detectContentLanguage, generateEntry } from "@lifebook/ai";
import { pickWeekColor } from "@lifebook/renderer";
import { prisma } from "../lib/db.js";
import { track } from "./analytics.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function generateShareToken(): string {
  return randomBytes(20).toString("base64url");
}

function entryText(entry: Pick<Entry, "rawText" | "transcript">): string {
  return (entry.transcript || entry.rawText || "").trim();
}

// One weekly entry → one Page (lightweight). Auto-saved as soon as the entry comes in.
// The artifact is the response — there is no "save?" gate, no chapter synthesis flow,
// no bookkeeping the user can see.
export async function createPageForEntry(user: User, entry: Entry): Promise<Page> {
  const text = entryText(entry);
  const language = detectContentLanguage(text, user.languageCode);

  const [entryNumber, recent, memories] = await Promise.all([
    prisma.page.count({ where: { userId: user.id } }).then((n) => n + 1),
    prisma.page.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { sceneTitle: true, quote: true, tags: true, createdAt: true }
    }),
    prisma.memory.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { type: true, title: true, content: true }
    })
  ]);

  const now = Date.now();
  const recentForPrompt = recent.map((p) => ({
    title: p.sceneTitle,
    quote: p.quote ?? null,
    tags: p.tags,
    daysAgo: Math.max(0, Math.floor((now - p.createdAt.getTime()) / ONE_DAY_MS))
  }));

  const output = await generateEntry({
    rawEntryOrTranscript: text,
    language,
    recentEntries: recentForPrompt,
    memories,
    entryNumber
  });

  const accent = pickWeekColor({ mood: output.mood, tags: output.tags, fallbackSeed: output.title }).key;

  const page = await prisma.page.create({
    data: {
      userId: user.id,
      entryId: entry.id,
      sceneTitle: output.title,
      sceneContent: output.body,
      quote: output.quote ?? null,
      // The new model folds biographer-thread observations into the body itself.
      // We keep the column populated for legacy DB schema compatibility but don't surface it.
      biographerNote: "",
      mood: output.mood,
      tags: output.tags,
      accentColor: accent,
      shareToken: generateShareToken()
    }
  });

  await prisma.$transaction([
    prisma.entry.update({ where: { id: entry.id }, data: { status: EntryStatus.SAVED } }),
    ...output.memoryUpdates.map((m) =>
      prisma.memory.create({
        data: {
          userId: user.id,
          type: m.type as MemoryType,
          title: m.title,
          content: m.content,
          confidence: m.confidence ?? 0.7
        }
      })
    )
  ]);

  // Lazy-init book share token now that there is real content.
  const book = await prisma.book.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, shareToken: true }
  });
  if (book && !book.shareToken) {
    await prisma.book.update({ where: { id: book.id }, data: { shareToken: generateShareToken() } });
  }

  track("entry_created", { userId: user.id, pageId: page.id, entryNumber });
  return page;
}

export async function entryCountForUser(userId: string): Promise<number> {
  return prisma.page.count({ where: { userId } });
}
