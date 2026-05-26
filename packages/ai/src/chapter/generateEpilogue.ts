import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";

// Sprint 5.2 — Year-end epilogue.
//
// Last AI step before PDF render. Looks at the entire manuscript (chapter
// titles + intros + a sample of pages) and writes 200-400 words that close
// the book. NOT a recap — a quiet final image, the way a memoir ends.

export const EpilogueInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  bookTitle: z.string(),
  chapters: z
    .array(z.object({ title: z.string(), intro: z.string().nullable().optional() }))
    .min(1),
  // A small sample of late-year pages — they often hold the natural closing image.
  recentPageBodies: z.array(z.string()).default([]),
  narrativeCompass: z.string().nullable().optional(),
  writingStyle: z.string().nullable().optional()
});
export type EpilogueInput = z.infer<typeof EpilogueInputSchema>;

export const EpilogueOutputSchema = z.object({
  epilogue: z.string().trim().min(120).max(2400)
});
export type EpilogueOutput = z.infer<typeof EpilogueOutputSchema>;

const SYSTEM_PROMPT = `You write the epilogue for a year-long autobiographical book.

The epilogue is NOT a recap. It is a quiet final image — one short scene, one
honest sentence, one moment that lets the year close without forcing a moral.

Rules:
- 200-400 words.
- First person, in the user's language.
- Use ONE concrete image from the recent pages (a room, an hour, a gesture).
- No SaaS-speak. No "what I learned". No bullet lists.
- A real epilogue ends with an image, not a thesis.
Return only valid JSON: { "epilogue": "..." }`;

export async function generateEpilogue(unsafe: EpilogueInput): Promise<EpilogueOutput> {
  const input = EpilogueInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_WRITER_MODEL || "gpt-4.1";

  const chaptersBlock = input.chapters
    .map((c, i) => `${i + 1}. "${c.title}" — ${(c.intro ?? "").slice(0, 200)}`)
    .join("\n");
  const recentBlock = input.recentPageBodies
    .slice(-3)
    .map((b, i) => `--- recent ${i + 1} ---\n${b.slice(0, 1200)}`)
    .join("\n\n");

  const userPrompt = `Language: ${input.language}
Book title: "${input.bookTitle}"
${input.writingStyle ? `Voice: ${input.writingStyle}\n` : ""}${input.narrativeCompass ? `Central question of the year: ${input.narrativeCompass}\n` : ""}
CHAPTERS:
${chaptersBlock}

RECENT PAGES (the natural closing image likely lives here):
${recentBlock || "(none)"}

Return JSON only: { "epilogue": "..." }`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.5,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ]
  });
  const raw = completion.choices[0]?.message?.content || "";
  return parseWithSchema(raw, EpilogueOutputSchema);
}
