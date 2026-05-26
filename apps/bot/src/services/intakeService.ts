import { extractIntakeMemories, type IntakeQuestionKind } from "@lifebook/ai";
import { MemoryType } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
// Sprint 3.4 — intake memories now flow through the deduper.
import { reviewAndStoreMemory } from "./memoryReviewService.js";

// 7 onboarding questions, structured to fit a Hero's Journey skeleton:
// origin → influence → call → companions → present → fear/dream → voice.
// Voice (Q7) is stored as User.writingStyle; the rest become INTAKE memories.
export type IntakeQuestion = {
  kind: IntakeQuestionKind;
  ru: string;
  en: string;
};

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    kind: "ORIGIN",
    ru: "Откуда ты родом? Где прошло детство — и что в нём было главным?",
    en: "Where are you from? Where did you grow up, and what was the heart of that childhood?"
  },
  {
    kind: "INFLUENCE",
    ru: "Кто на тебя сильнее всего повлиял — родитель, друг, учитель, кто-то ещё?",
    en: "Who shaped you most — a parent, friend, teacher, someone else?"
  },
  {
    kind: "TURNING_POINT",
    ru: "Какой важный поворот в твоей жизни случился ДО этого года?",
    en: "What important turning point happened in your life BEFORE this year?"
  },
  {
    kind: "COMPANIONS",
    ru: "Кто рядом с тобой сейчас? Назови 3-5 ключевых людей и пару слов про каждого.",
    en: "Who is in your life right now? Name 3-5 key people, with a line about each."
  },
  {
    kind: "CURRENT_LIFE",
    ru: "Что ты сейчас проживаешь? Куда движется этот год?",
    en: "What are you living through right now? Where is this year heading?"
  },
  {
    kind: "FEAR_DREAM",
    ru: "Чего ты больше всего боишься потерять — и о чём мечтаешь?",
    en: "What are you most afraid of losing — and what do you dream of?"
  },
  {
    kind: "VOICE",
    ru: "Каким голосом писать твою книгу? Спокойным, ироничным, прямым, тёплым, сдержанным — как тебе ближе?",
    en: "What voice should the book have? Calm, ironic, direct, warm, restrained — what feels right?"
  }
];

export function totalIntakeQuestions(): number {
  return INTAKE_QUESTIONS.length;
}

export function getIntakeQuestion(index: number): IntakeQuestion | null {
  return INTAKE_QUESTIONS[index] ?? null;
}

// Persist one intake answer:
// - For the VOICE question: writes User.writingStyle directly.
// - For all others: AI extracts MemoryUpdates, stored as INTAKE memories with confidence 0.95.
export async function recordIntakeAnswer(opts: {
  userId: string;
  questionIndex: number;
  answer: string;
  language: string;
}): Promise<{ memoryCount: number; voiceSaved: boolean }> {
  const q = getIntakeQuestion(opts.questionIndex);
  if (!q) return { memoryCount: 0, voiceSaved: false };

  if (q.kind === "VOICE") {
    const trimmed = opts.answer.trim().slice(0, 200);
    if (trimmed) {
      await prisma.user.update({
        where: { id: opts.userId },
        data: { writingStyle: trimmed }
      });
    }
    return { memoryCount: 0, voiceSaved: Boolean(trimmed) };
  }

  let extraction;
  try {
    extraction = await extractIntakeMemories({
      kind: q.kind,
      answer: opts.answer,
      language: opts.language
    });
  } catch (err) {
    logger.warn({ err, kind: q.kind }, "extractIntakeMemories failed (skipping)");
    return { memoryCount: 0, voiceSaved: false };
  }

  if (!extraction.memories.length) return { memoryCount: 0, voiceSaved: false };

  // Sprint 3.4 — onboarding intake also flows through memoryReviewService.
  // Two intake answers can mention the same person ("моя мама" in Q4 and again
  // in Q6 with a different angle); the dedupe ensures we end up with ONE
  // mama-entity collecting both pieces of evidence as MemoryRevisions.
  // INTAKE category preserved so /memories can show foundational facts first.
  let stored = 0;
  for (const m of extraction.memories) {
    try {
      await reviewAndStoreMemory({
        userId: opts.userId,
        type: m.type as MemoryType,
        rawName: m.title,
        evidence: m.content,
        language: opts.language === "en" ? "en" : "ru",
        category: "INTAKE"
      });
      stored += 1;
    } catch (err) {
      logger.warn(
        { err: { message: (err as Error).message }, name: m.title, type: m.type, kind: q.kind },
        "intake memory store failed (skipping one)"
      );
    }
  }
  return { memoryCount: stored, voiceSaved: false };
}

// Prologue is now a SINGLE continuous narrative split across N sequential pages,
// not N separate chapters. The AI sees previous pages while writing each new one.
// Page briefs (origin → influence → turning → companions → threshold) live in
// the AI package (PROLOGUE_PAGE_BRIEFS). The bot just loops through them.
