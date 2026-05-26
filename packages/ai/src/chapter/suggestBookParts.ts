import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";

// Sprint 5 — Suggest book parts before PDF render.
//
// When the manuscript reaches ~13+ pages and has 4+ chapters, the orchestrator
// asks: «can we group these chapters into 2-3 Parts?». The model returns a
// proposed division with a title and a 1-2 sentence intro per part. The
// orchestrator persists BookPart rows and updates Chapter.partId mapping.
//
// The model MAY return an empty parts list — meaning «not yet, the manuscript
// reads better as one continuous flow». Trust that decision; don't force parts.

export const SuggestPartsInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  bookTitle: z.string(),
  chapters: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        intro: z.string().nullable().optional(),
        themes: z.array(z.string()).default([]),
        orderIndex: z.number().int().nonnegative()
      })
    )
    .min(4)
});
export type SuggestPartsInput = z.infer<typeof SuggestPartsInputSchema>;

export const SuggestPartsOutputSchema = z.object({
  parts: z.array(
    z.object({
      title: z.string().trim().min(2).max(120),
      intro: z.string().trim().min(20).max(800).nullable().optional(),
      chapterIds: z.array(z.string()).min(1)
    })
  ),
  rationale: z.string().trim().min(8).max(280)
});
export type SuggestPartsOutput = z.infer<typeof SuggestPartsOutputSchema>;

const SYSTEM_PROMPT = `You divide an autobiographical book's chapters into 2-3 Parts.

A Part is a top-level section: think «Beginning», «Turning», «Becoming» — but
NEVER use those generic words. Pull a concrete word from the chapters.

Rules:
- 0, 2, or 3 parts. NEVER 1 — that's just no division.
- Every chapter must end up in exactly one part (no orphans, no overlap).
- Each part contains 2+ consecutive chapters by orderIndex.
- Part title: 2-5 words, concrete, no SaaS-speak.
- Part intro: 1-3 sentences, ≤ 600 chars, in the user's language.
- If the chapters don't naturally divide, return parts: [] and explain in rationale.
Return only valid JSON.`;

export async function suggestBookParts(unsafe: SuggestPartsInput): Promise<SuggestPartsOutput> {
  const input = SuggestPartsInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini";

  const chaptersBlock = input.chapters
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((c) => `${c.orderIndex + 1}. id=${c.id} "${c.title}" themes=[${c.themes.join(", ")}] intro="${(c.intro ?? "").slice(0, 240)}"`)
    .join("\n");

  const userPrompt = `Language: ${input.language}
Book title: "${input.bookTitle}"

CHAPTERS (in book order):
${chaptersBlock}

Return JSON: { "parts": [{ "title": "...", "intro": "..." | null, "chapterIds": ["..."] }], "rationale": "..." }`;

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
  return parseWithSchema(raw, SuggestPartsOutputSchema);
}
