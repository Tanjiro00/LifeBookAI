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
// body max bumped to 2800 chars to accommodate 360-word Russian prose (~6.5 chars/word).
// The previous 1400-char ceiling silently rejected most non-mock AI completions, so
// the prologue path was falling through to the deterministic mock template — one of
// the highest-impact UX bugs we shipped. If you ever need to tighten this, do it on
// the prompt side ("max N words"), not the schema.
export const EntryOutputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(80).max(2800),
  quote: OptionalText,
  // Sprint 0.4 — Two new fields that drive the new delivery layer.
  // teaser:      what the user sees on the poster-card. A 1–3 sentence opener of the
  //              scene the page renders, NEVER the whole body. Hard-capped at 280 chars
  //              so the card layout in renderPosterCard.ts stays predictable.
  // pageSummary: an internal one-liner (≤ 400 chars) — used as fuel for narrative
  //              context (Sprint 1) and for the «Я запомнил» follow-ups (Sprint 3).
  //              Never shown to the user verbatim.
  // Both are made optional with safe fallbacks so older AI completions and the mock
  // fallback don't break — pageDeliveryService trims body to a teaser when missing.
  teaser: z
    .preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z.string().trim().min(20).max(280).optional()
    ),
  pageSummary: z
    .preprocess(
      (v) => (v === null || v === undefined || v === "" ? undefined : v),
      z.string().trim().min(20).max(400).optional()
    ),
  mood: TextArray,
  tags: TextArray,
  memoryUpdates: z.array(MemoryUpdateSchema).max(4).default([])
});
export type EntryOutput = z.infer<typeof EntryOutputSchema>;

// Sprint 1.7 — GenerationContext bodies passed to the writer.
//
// `recentEntries` (legacy: titles + tags only) is preserved for backwards
// compatibility, but the new `recentBodies` / `prologueBodies` / `relatedBodies`
// fields carry the actual prose the writer needs to weave continuity. Without
// these, every page is written effectively from scratch (the «52 disconnected
// vignettes» bug we set out to fix).
const PageBodySnippet = z.object({
  pageId: z.string().optional(),
  title: z.string(),
  body: z.string(),
  teaser: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  mood: z.array(z.string()).default([]),
  daysAgo: z.number().int().nonnegative().default(0),
  similarity: z.number().optional()
});

export const GenerateEntryInputSchema = z.object({
  rawEntryOrTranscript: z.string().trim().min(10),
  language: z.string().optional().default("ru"),
  // Legacy compact recents: kept so older callers still typecheck. New callers
  // populate recentBodies instead.
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
  // Sprint 1.7 — full prose of the 2 most recent current pages.
  recentBodies: z.array(PageBodySnippet).default([]),
  // Up to 5 prologue bodies; foundation of the book the writer can echo from.
  prologueBodies: z.array(PageBodySnippet).default([]),
  // Top-K semantically similar pages from anywhere in the corpus. The writer
  // is told to make ≤2 specific echoes from this set, never to summarize them.
  relatedBodies: z.array(PageBodySnippet).default([]),
  memories: z
    .array(z.object({ type: z.string(), title: z.string(), content: z.string() }))
    .default([]),
  entryNumber: z.number().int().positive(),
  // Compact biographer briefing — the long-running summary of who this person is. Optional;
  // when present, every page-prompt uses it as foundation so the book accumulates a single arc.
  lifeContext: z.string().optional().nullable()
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
