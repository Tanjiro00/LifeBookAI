import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";

// Sprint 4.7 — Add a detail to the chapter intro.
//
// The user tapped «➕ Добавить деталь в intro» on the chapter card. They typed
// some context — a memory of the period, a thread the AI missed, an emotional
// note. We rewrite ONLY the intro (no title, no page bodies) to weave in the
// new detail.
//
// Crucially: preserve everything the user did not contradict. The new intro
// reads as if the user's detail had always been part of the synthesis.

export const ReviseChapterIntroInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  chapterTitle: z.string(),
  chapterSubtitle: z.string().nullable().optional(),
  previousIntro: z.string(),
  userDetail: z.string().trim().min(2).max(1500)
});
export type ReviseChapterIntroInput = z.infer<typeof ReviseChapterIntroInputSchema>;

export const ReviseChapterIntroOutputSchema = z.object({
  intro: z.string().trim().min(60).max(2200)
});
export type ReviseChapterIntroOutput = z.infer<typeof ReviseChapterIntroOutputSchema>;

const SYSTEM_PROMPT = `You revise the INTRO of an autobiographical book chapter according to a detail the user wants reflected.

Rules:
- Touch ONLY the intro. The title, subtitle, and the chapter's pages stay.
- Preserve every concrete image and reference already in the intro unless the
  user's detail directly contradicts them.
- Weave the new detail in naturally — no "Editor's note:" or "Update:" markers.
- Stay in the same language as the previous intro.
- Length: 100-250 words.
- No SaaS-speak. No moralising.
Return only valid JSON: { "intro": "..." }`;

export async function reviseChapterIntro(
  unsafe: ReviseChapterIntroInput
): Promise<ReviseChapterIntroOutput> {
  const input = ReviseChapterIntroInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini";

  const userPrompt = `Language: ${input.language}
Chapter title: "${input.chapterTitle}"
${input.chapterSubtitle ? `Chapter subtitle: "${input.chapterSubtitle}"\n` : ""}
PREVIOUS INTRO:
"""
${input.previousIntro}
"""

USER'S NEW DETAIL (authoritative, weave it in):
"""
${input.userDetail}
"""

Return JSON only: { "intro": "..." }`;

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
  return parseWithSchema(raw, ReviseChapterIntroOutputSchema);
}
