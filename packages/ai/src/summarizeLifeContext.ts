import { z } from "zod";
import { getOpenAiClient } from "./openaiClient.js";

export const SummarizeLifeContextInputSchema = z.object({
  firstName: z.string().optional().nullable(),
  language: z.string().optional().default("ru"),
  writingStyle: z.string().optional().nullable(),
  memories: z
    .array(z.object({ category: z.string().optional().default("EXTRACTED"), type: z.string(), title: z.string(), content: z.string() }))
    .default([]),
  recentPages: z
    .array(z.object({ title: z.string(), tags: z.array(z.string()).default([]), mood: z.array(z.string()).default([]) }))
    .default([])
});
export type SummarizeLifeContextInput = z.infer<typeof SummarizeLifeContextInputSchema>;

const SYSTEM_PROMPT = `You compress a person's biographical and current-year context into one
short briefing that another instance of you (the biographer) will use as foundation
when writing the next weekly page. This is internal scaffolding — the user will never
see this text directly.

Style:
- Plain prose, third-person about the user. NO list bullets, NO sections.
- ≤ 200 words. Aim for ~150.
- Cover: where they're from, the few people who matter most, the one or two recurring
  themes of the year so far, the tension or question the year seems to be living, the
  voice the book is written in.
- Do not invent. Pull only from the facts you're given.
- If facts are sparse, the briefing is also sparse and honest about it.
- Same language as the user.`;

function buildPrompt(input: SummarizeLifeContextInput): string {
  const intake = input.memories.filter((m) => m.category === "INTAKE");
  const extracted = input.memories.filter((m) => m.category !== "INTAKE");
  return `Write the BIOGRAPHER'S BRIEFING for ${input.firstName || "this user"}.

Intake (told to us during onboarding — high confidence):
${intake.map((m) => `- [${m.type}] ${m.title}: ${m.content}`).join("\n") || "(none)"}

Extracted (inferred from weekly entries):
${extracted.map((m) => `- [${m.type}] ${m.title}: ${m.content}`).join("\n") || "(none)"}

Recent weekly pages (titles + tags + mood):
${input.recentPages.map((p) => `- "${p.title}" — ${p.tags.slice(0, 3).join(", ")} [${p.mood.slice(0, 2).join("/")}]`).join("\n") || "(none yet)"}

Language: ${input.language}
${input.writingStyle ? `Book voice: ${input.writingStyle}` : ""}

Output ONLY the prose briefing, ≤ 200 words. No JSON, no headings, no markdown.`;
}

export async function summarizeLifeContext(unsafe: SummarizeLifeContextInput): Promise<string> {
  const input = SummarizeLifeContextInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";

  // On any failure return an empty briefing rather than fabricated prose.
  // The writer's buildEntryPrompt treats empty lifeContext as "no briefing
  // available" and falls back to other context sources.
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.5,
      top_p: 0.9,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(input) }
      ]
    });
    const text = completion.choices[0]?.message?.content?.trim() || "";
    return text.slice(0, 1800);
  } catch {
    return "";
  }
}
