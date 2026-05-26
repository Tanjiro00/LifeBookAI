import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";

// Sprint 4.1 — Chapter synthesis.
//
// Master spec §11.1: every few weeks the system looks at the recent
// unchaptered Pages and decides:
//   - shouldCreateChapter? (only when 4-6 pages clearly cohere)
//   - title (concrete noun phrase pulled from the pages)
//   - subtitle (optional)
//   - intro (100-250 word biographer's bridge prose between previous and new)
//   - summary (3-4 sentence internal scaffolding for retrieval)
//   - which page IDs to include (all of them or a coherent subset)
//   - themes / people / places extracted from the pages
//
// The model is told it MAY return shouldCreateChapter=false — chapter creation
// is gated on the pages actually feeling like a unit, not on a calendar tick.
// In that case the orchestrator just waits another page and tries again.
//
// Two failure modes the prompt explicitly guards against:
//   1. Naming a chapter from a single dominant page ("ignored the others").
//   2. Inventing themes the pages don't support.

export const ChapterSynthInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  // Pages that are candidates for grouping into one chapter — most recent
  // unchaptered current pages.
  pages: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        body: z.string(),
        summary: z.string().nullable().optional(),
        tags: z.array(z.string()).default([]),
        mood: z.array(z.string()).default([]),
        createdAt: z.string()
      })
    )
    .min(2),
  // For continuity: title of the previous chapter (if any). Helps the model
  // pick a fresh title that doesn't repeat themes already named.
  previousChapterTitle: z.string().nullable().optional(),
  // Active narrative threads (Sprint 3). The model should let threads inform
  // theme detection but never name a chapter after a thread directly.
  threads: z
    .array(z.object({ title: z.string(), summary: z.string() }))
    .default([]),
  writingStyle: z.string().nullable().optional()
});
export type ChapterSynthInput = z.infer<typeof ChapterSynthInputSchema>;

export const ChapterSynthOutputSchema = z.object({
  shouldCreateChapter: z.boolean(),
  // Optional fields only required when shouldCreateChapter=true.
  title: z.string().trim().min(2).max(120).optional(),
  subtitle: z.string().trim().max(200).nullable().optional(),
  intro: z.string().trim().min(60).max(2200).optional(),
  summary: z.string().trim().min(40).max(800).optional(),
  pageIds: z.array(z.string()).default([]),
  themes: z.array(z.string()).max(6).default([]),
  people: z.array(z.string()).max(8).default([]),
  places: z.array(z.string()).max(6).default([]),
  // 1-sentence internal note for the orchestrator's logs — why this is or
  // isn't a coherent chapter. Always present.
  rationale: z.string().trim().min(8).max(280)
});
export type ChapterSynthOutput = z.infer<typeof ChapterSynthOutputSchema>;

const SYSTEM_PROMPT = `You are the editor synthesising a chapter from a sequence of just-written pages of a personal autobiography.

Your job is NOT to write the pages themselves. Your job is to decide:
  1. Do these pages actually cohere into a chapter?
     A chapter exists when 3+ of the pages share a clear thematic, emotional,
     or temporal thread. If they do not, return shouldCreateChapter: false.
  2. If yes, name and frame it.

Title rules:
  - 2-7 words. Concrete; pull a real word or image from the pages.
  - NEVER "Chapter X" / "Глава X" / "Part of the Year".
  - NOT a moral or a thesis statement.
  - Must NOT repeat the previousChapterTitle's main word.

Subtitle (optional):
  - 0-1 line, ≤ 12 words. Concrete, not motivational. null is acceptable.

Intro:
  - 100-250 words of biographer's prose IN THE USER'S LANGUAGE.
  - Reads as a bridge between the previous chapter and these pages — quietly
    setting the reader up for what changed in this stretch.
  - Use ONE concrete image from the pages. Do NOT recap each page.
  - Third-person about the user is acceptable here (the intro is an editor's
    voice, not the user's voice). First-person is also acceptable if it stays
    in the user's natural register.
  - No SaaS-speak: "journey", "transformation", "growth", "healing", etc.

Summary:
  - 3-4 neutral factual sentences. Internal scaffolding the reader never sees.
  - Lists the central scenes / people / places the chapter covers.

themes/people/places:
  - Up to 6/8/6. Pulled VERBATIM from the pages — names exactly as the user
    spelled them.

If shouldCreateChapter: false, leave title/subtitle/intro/summary/pageIds
empty and put your reasoning in rationale.

Return only valid JSON matching the schema.`;

export async function synthesizeChapter(unsafe: ChapterSynthInput): Promise<ChapterSynthOutput> {
  const input = ChapterSynthInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini";

  const pagesBlock = input.pages
    .map((p) => {
      const trimmed = p.body.length > 1500 ? p.body.slice(0, 1500) + "…" : p.body;
      const tags = p.tags.length ? ` [${p.tags.slice(0, 4).join(", ")}]` : "";
      return `--- id=${p.id} ${p.createdAt.slice(0, 10)} — "${p.title}"${tags} ---\n${trimmed}`;
    })
    .join("\n\n");

  const threadsBlock = input.threads.length
    ? input.threads.map((t) => `- "${t.title}": ${t.summary}`).join("\n")
    : "(none)";

  const userPrompt = `Language: ${input.language}
${input.writingStyle ? `Voice: ${input.writingStyle}` : ""}
Previous chapter title: ${input.previousChapterTitle ?? "(none — first chapter)"}

ACTIVE THREADS:
${threadsBlock}

CANDIDATE PAGES (in chronological order):
${pagesBlock}

Decide whether these pages cohere into a single chapter and, if yes, name and
frame it. Return JSON only with this exact shape:

{
  "shouldCreateChapter": true | false,
  "title": "...",
  "subtitle": "..." | null,
  "intro": "...",
  "summary": "...",
  "pageIds": ["..."],
  "themes": ["..."],
  "people": ["..."],
  "places": ["..."],
  "rationale": "..."
}`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ]
  });
  const raw = completion.choices[0]?.message?.content || "";
  return parseWithSchema(raw, ChapterSynthOutputSchema);
}
