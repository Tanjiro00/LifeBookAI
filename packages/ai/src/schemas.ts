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

export const MemoryUpdateSchema = z.object({
  type: MemoryTypeSchema,
  title: z.string().trim().min(3).max(140),
  content: z.string().trim().min(8).max(700),
  confidence: z.number().min(0).max(1).optional().default(0.7)
});
export type MemoryUpdate = z.infer<typeof MemoryUpdateSchema>;

// One weekly entry — what the user sees as a card. The schema is intentionally
// minimal: title, body, optional quote, mood/tags. No required "biographer note"
// field — if the AI sees a thread, it weaves it into the body.
export const EntryOutputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(80).max(1400),
  quote: OptionalText,
  mood: TextArray,
  tags: TextArray,
  memoryUpdates: z.array(MemoryUpdateSchema).max(4).default([])
});
export type EntryOutput = z.infer<typeof EntryOutputSchema>;

export const GenerateEntryInputSchema = z.object({
  rawEntryOrTranscript: z.string().trim().min(10),
  language: z.string().optional().default("ru"),
  recentEntries: z
    .array(
      z.object({
        title: z.string(),
        quote: z.string().optional().nullable(),
        tags: z.array(z.string()).default([]),
        daysAgo: z.number().int().nonnegative()
      })
    )
    .default([]),
  memories: z
    .array(z.object({ type: z.string(), title: z.string(), content: z.string() }))
    .default([]),
  entryNumber: z.number().int().positive()
});
export type GenerateEntryInput = z.infer<typeof GenerateEntryInputSchema>;

// Cover & title generation for the year-end book.
export const NameBookInputSchema = z.object({
  entries: z
    .array(z.object({ title: z.string(), tags: z.array(z.string()).default([]), mood: z.array(z.string()).default([]) }))
    .min(3),
  language: z.string().optional().default("ru")
});
export type NameBookInput = z.infer<typeof NameBookInputSchema>;

export const NameBookOutputSchema = z.object({
  title: z.string().trim().min(2).max(80),
  subtitle: OptionalText
});
export type NameBookOutput = z.infer<typeof NameBookOutputSchema>;

export const GenerateCoverInputSchema = z.object({
  bookTitle: z.string(),
  themes: z.array(z.string()).default([]),
  mood: z.array(z.string()).default([])
});
export type GenerateCoverInput = z.infer<typeof GenerateCoverInputSchema>;

export const TranscriptionOutputSchema = z.object({
  transcript: z.string().trim().min(1),
  language: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  durationSeconds: z.number().positive().optional()
});
export type TranscriptionOutput = z.infer<typeof TranscriptionOutputSchema>;
