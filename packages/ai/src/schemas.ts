import { z } from "zod";

export const MemoryTypeSchema = z.enum([
  "PERSON",
  "PLACE",
  "THEME",
  "LIFE_EVENT",
  "GOAL",
  "FEAR",
  "ACHIEVEMENT",
  "PREFERENCE"
]);

const OptionalText = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }
    return value;
  },
  z.string().trim().min(1).optional()
);

const TextArray = z
  .array(z.string().trim().min(1))
  .default([])
  .transform((items) => Array.from(new Set(items)).slice(0, 12));

export const ClarifyingQuestionSchema = z.object({
  question: z.string().trim().min(8).max(280),
  reason: OptionalText
});

export const ClarifyingQuestionsOutputSchema = z.object({
  questions: z.array(ClarifyingQuestionSchema).min(2).max(4)
});

export const MemoryUpdateSchema = z.object({
  type: MemoryTypeSchema,
  title: z.string().trim().min(3).max(140),
  content: z.string().trim().min(8).max(700),
  confidence: z.number().min(0).max(1).optional().default(0.7)
});

export const ChapterOutputSchema = z.object({
  title: z.string().trim().min(3).max(180),
  subtitle: OptionalText,
  summary: OptionalText,
  content: z.string().trim().min(120),
  quote: OptionalText,
  mood: TextArray,
  tags: TextArray,
  people: TextArray,
  places: TextArray,
  keyEvents: TextArray,
  memoryUpdates: z.array(MemoryUpdateSchema).max(8).default([])
});

export const GenerateClarifyingQuestionsInputSchema = z.object({
  rawEntryOrTranscript: z.string().trim().min(10),
  writingGoal: z.string().optional().nullable(),
  writingStyle: z.string().optional().nullable(),
  language: z.string().optional().default("ru")
});

export const GenerateChapterInputSchema = z.object({
  rawEntryOrTranscript: z.string().trim().min(10),
  answers: z.string().optional().nullable(),
  memories: z
    .array(
      z.object({
        type: MemoryTypeSchema,
        title: z.string(),
        content: z.string()
      })
    )
    .default([]),
  writingGoal: z.string().optional().nullable(),
  writingStyle: z.string().optional().nullable(),
  language: z.string().optional().default("ru")
});

export const StyleAdjustmentSchema = z.enum([
  "less_dramatic",
  "shorter",
  "more_literary",
  "more_like_me",
  "regenerate"
]);

export const AdjustChapterInputSchema = z.object({
  chapter: ChapterOutputSchema,
  rawEntryOrTranscript: z.string().trim().min(10),
  answers: z.string().optional().nullable(),
  styleAdjustment: StyleAdjustmentSchema,
  writingGoal: z.string().optional().nullable(),
  writingStyle: z.string().optional().nullable(),
  language: z.string().optional().default("ru")
});

export const TranscriptionOutputSchema = z.object({
  transcript: z.string().trim().min(1),
  language: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  durationSeconds: z.number().positive().optional()
});

export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestionSchema>;
export type ClarifyingQuestionsOutput = z.infer<typeof ClarifyingQuestionsOutputSchema>;
export type ChapterOutput = z.infer<typeof ChapterOutputSchema>;
export type MemoryUpdate = z.infer<typeof MemoryUpdateSchema>;
export type GenerateClarifyingQuestionsInput = z.infer<typeof GenerateClarifyingQuestionsInputSchema>;
export type GenerateChapterInput = z.infer<typeof GenerateChapterInputSchema>;
export type StyleAdjustment = z.infer<typeof StyleAdjustmentSchema>;
export type AdjustChapterInput = z.infer<typeof AdjustChapterInputSchema>;
export type TranscriptionOutput = z.infer<typeof TranscriptionOutputSchema>;
