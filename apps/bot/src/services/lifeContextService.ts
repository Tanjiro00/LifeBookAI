import { summarizeLifeContext } from "@lifebook/ai";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const RECENT_PAGES_FOR_SUMMARY = 12;
const MAX_MEMORIES_FOR_SUMMARY = 30;

// Recompute User.lifeContext from intake + extracted memories + recent pages.
// Called: once after onboarding intake completes; then opportunistically every Nth
// weekly entry. The result is plain prose; future page-generation prompts paste it
// in verbatim as the biographer's foundation.
export async function refreshLifeContext(userId: string): Promise<string | null> {
  try {
    const [user, memories, pages] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, languageCode: true, writingStyle: true }
      }),
      prisma.memory.findMany({
        where: { userId },
        orderBy: [{ category: "asc" }, { confidence: "desc" }, { updatedAt: "desc" }],
        take: MAX_MEMORIES_FOR_SUMMARY,
        select: { category: true, type: true, title: true, content: true }
      }),
      prisma.page.findMany({
        where: { userId, kind: "WEEKLY" },
        orderBy: { createdAt: "desc" },
        take: RECENT_PAGES_FOR_SUMMARY,
        select: { sceneTitle: true, tags: true, mood: true }
      })
    ]);
    if (!user) return null;

    const language = (user.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";

    const context = await summarizeLifeContext({
      firstName: user.firstName,
      language,
      writingStyle: user.writingStyle,
      memories,
      recentPages: pages.map((p) => ({ title: p.sceneTitle, tags: p.tags, mood: p.mood }))
    });

    if (!context) return null;

    await prisma.user.update({
      where: { id: userId },
      data: { lifeContext: context, lifeContextUpdatedAt: new Date() }
    });
    return context;
  } catch (err) {
    logger.warn({ err, userId }, "refreshLifeContext failed (non-fatal)");
    return null;
  }
}
