import { randomBytes } from "node:crypto";
import { EntryStatus, MemoryType, UserState, type Chapter, type Entry, type User } from "@prisma/client";
import {
  adjustChapterStyle,
  generateChapter,
  generateClarifyingQuestions,
  type ChapterOutput,
  type StyleAdjustment
} from "@lifebook/ai";
import { prisma } from "../lib/db.js";
import { track } from "./analytics.js";

export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function getEntryText(entry: Pick<Entry, "rawText" | "transcript">): string {
  return (entry.transcript || entry.rawText || "").trim();
}

export async function createTextEntry(user: User, text: string): Promise<Entry> {
  const now = new Date();
  return prisma.entry.create({
    data: {
      userId: user.id,
      rawText: text,
      status: EntryStatus.COLLECTED,
      periodEnd: now,
      periodStart: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)
    }
  });
}

export async function createVoiceEntry(user: User, params: { telegramVoiceId: string; audioUrl: string; transcript: string }): Promise<Entry> {
  const now = new Date();
  return prisma.entry.create({
    data: {
      userId: user.id,
      telegramVoiceId: params.telegramVoiceId,
      audioUrl: params.audioUrl,
      transcript: params.transcript,
      status: EntryStatus.COLLECTED,
      periodEnd: now,
      periodStart: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)
    }
  });
}

export async function latestEntryForAnswers(userId: string): Promise<(Entry & { questions: { id: string; question: string; sortOrder: number }[] }) | null> {
  return prisma.entry.findFirst({
    where: {
      userId,
      status: EntryStatus.QUESTIONS_GENERATED
    },
    orderBy: { createdAt: "desc" },
    include: {
      questions: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          question: true,
          sortOrder: true
        }
      }
    }
  });
}

export async function generateAndPersistQuestions(user: User, entry: Entry) {
  track("questions_generated", { userId: user.id, entryId: entry.id });
  const output = await generateClarifyingQuestions({
    rawEntryOrTranscript: getEntryText(entry),
    writingGoal: user.writingGoal,
    writingStyle: user.writingStyle,
    language: user.languageCode || "ru"
  });

  await prisma.$transaction([
    prisma.clarificationQuestion.deleteMany({ where: { entryId: entry.id } }),
    prisma.clarificationQuestion.createMany({
      data: output.questions.map((item, index) => ({
        entryId: entry.id,
        question: item.question,
        reason: item.reason ?? null,
        sortOrder: index + 1
      }))
    }),
    prisma.entry.update({
      where: { id: entry.id },
      data: { status: EntryStatus.QUESTIONS_GENERATED }
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { state: UserState.WAITING_FOR_ANSWERS }
    })
  ]);

  return output.questions;
}

export async function saveAnswers(entryId: string, answerText: string): Promise<void> {
  const questions = await prisma.clarificationQuestion.findMany({
    where: { entryId },
    orderBy: { sortOrder: "asc" }
  });

  const answerLines = answerText
    .split(/\n+/)
    .map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean);

  await prisma.$transaction([
    ...questions.map((question, index) =>
      prisma.clarificationQuestion.update({
        where: { id: question.id },
        data: {
          answer: answerLines[index] || (index === 0 ? answerText : null),
          answeredAt: new Date()
        }
      })
    ),
    prisma.entry.update({
      where: { id: entryId },
      data: { status: EntryStatus.ANSWERS_COLLECTED }
    })
  ]);
}

export async function collectAnswersText(entryId: string): Promise<string> {
  const questions = await prisma.clarificationQuestion.findMany({
    where: { entryId },
    orderBy: { sortOrder: "asc" }
  });

  return questions
    .filter((question) => question.answer)
    .map((question) => `${question.question}\n${question.answer}`)
    .join("\n\n");
}

export async function generateAndPersistChapter(user: User, entryId: string): Promise<Chapter> {
  const entry = await prisma.entry.findUniqueOrThrow({ where: { id: entryId } });
  const memories = await prisma.memory.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { type: true, title: true, content: true }
  });

  track("chapter_generation_started", { userId: user.id, entryId });
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.GENERATING_CHAPTER } });
  await prisma.entry.update({ where: { id: entryId }, data: { status: EntryStatus.GENERATING_CHAPTER } });

  const output = await generateChapter({
    rawEntryOrTranscript: getEntryText(entry),
    answers: await collectAnswersText(entryId),
    memories,
    writingGoal: user.writingGoal,
    writingStyle: user.writingStyle,
    language: user.languageCode || "ru"
  });

  const chapter = await persistGeneratedChapter(user.id, entryId, output);
  track("chapter_generated", { userId: user.id, chapterId: chapter.id });
  return chapter;
}

async function persistGeneratedChapter(userId: string, entryId: string, output: ChapterOutput): Promise<Chapter> {
  const book = await prisma.book.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  const chapter = await prisma.chapter.upsert({
    where: { entryId },
    create: {
      userId,
      entryId,
      bookId: book?.id ?? null,
      title: output.title,
      subtitle: output.subtitle ?? null,
      summary: output.summary ?? null,
      content: output.content,
      quote: output.quote ?? null,
      mood: output.mood,
      tags: output.tags,
      people: output.people,
      places: output.places,
      keyEvents: output.keyEvents,
      shareToken: generateShareToken(),
      isPrivate: true
    },
    update: {
      title: output.title,
      subtitle: output.subtitle ?? null,
      summary: output.summary ?? null,
      content: output.content,
      quote: output.quote ?? null,
      mood: output.mood,
      tags: output.tags,
      people: output.people,
      places: output.places,
      keyEvents: output.keyEvents,
      version: { increment: 1 }
    }
  });

  await prisma.$transaction([
    prisma.entry.update({ where: { id: entryId }, data: { status: EntryStatus.CHAPTER_GENERATED } }),
    prisma.user.update({ where: { id: userId }, data: { state: UserState.REVIEWING_CHAPTER } }),
    ...output.memoryUpdates.map((memory) =>
      prisma.memory.create({
        data: {
          userId,
          sourceChapterId: chapter.id,
          type: memory.type as MemoryType,
          title: memory.title,
          content: memory.content,
          confidence: memory.confidence
        }
      })
    )
  ]);

  return chapter;
}

export async function adjustAndPersistChapter(user: User, chapterId: string, styleAdjustment: StyleAdjustment): Promise<Chapter> {
  const chapter = await prisma.chapter.findFirstOrThrow({
    where: { id: chapterId, userId: user.id },
    include: {
      entry: true
    }
  });

  const output = await adjustChapterStyle({
    chapter: {
      title: chapter.title,
      subtitle: chapter.subtitle ?? undefined,
      summary: chapter.summary ?? undefined,
      content: chapter.content,
      quote: chapter.quote ?? undefined,
      mood: chapter.mood,
      tags: chapter.tags,
      people: chapter.people,
      places: chapter.places,
      keyEvents: chapter.keyEvents,
      memoryUpdates: []
    },
    rawEntryOrTranscript: getEntryText(chapter.entry),
    answers: await collectAnswersText(chapter.entryId),
    styleAdjustment,
    writingGoal: user.writingGoal,
    writingStyle: user.writingStyle,
    language: user.languageCode || "ru"
  });

  const updated = await prisma.chapter.update({
    where: { id: chapter.id },
    data: {
      title: output.title,
      subtitle: output.subtitle ?? null,
      summary: output.summary ?? null,
      content: output.content,
      quote: output.quote ?? null,
      mood: output.mood,
      tags: output.tags,
      people: output.people,
      places: output.places,
      keyEvents: output.keyEvents,
      version: { increment: 1 }
    }
  });

  track(styleAdjustment === "regenerate" ? "chapter_regenerated" : "style_adjusted", {
    userId: user.id,
    chapterId: chapter.id,
    styleAdjustment
  });

  return updated;
}

export async function saveChapter(user: User, chapterId: string): Promise<{ chapter: Chapter; savedCount: number }> {
  const chapter = await prisma.chapter.update({
    where: { id: chapterId },
    data: {
      isSaved: true,
      isPrivate: true,
      entry: {
        update: {
          status: EntryStatus.SAVED
        }
      }
    }
  });

  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.CHAPTER_SAVED } });
  const savedCount = await prisma.chapter.count({ where: { userId: user.id, isSaved: true } });
  track("chapter_saved", { userId: user.id, chapterId, savedCount });

  return { chapter, savedCount };
}

export async function deleteLatestSavedChapter(userId: string): Promise<Chapter | null> {
  const chapter = await prisma.chapter.findFirst({
    where: { userId, isSaved: true },
    orderBy: { createdAt: "desc" }
  });

  if (!chapter) {
    return null;
  }

  await prisma.chapter.delete({ where: { id: chapter.id } });
  return chapter;
}

export function formatQuestions(questions: { question: string }[]): string {
  const lines = questions.map((question, index) => `${index + 1}. ${question.question}`);
  return [
    "Хочу уточнить пару вещей, чтобы глава звучала по-настоящему:",
    "",
    ...lines,
    "",
    "Ответь одним сообщением — можно коротко."
  ].join("\n");
}
