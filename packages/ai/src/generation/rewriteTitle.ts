import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";

// Sprint 2.7 — Title-only rewrite.
//
// A targeted, cheap call. The body stays untouched; only the title changes.
// Used by the «🏷 Заголовок» button: the user can re-roll the title without
// risking the prose they liked.

const SYSTEM_PROMPT = `You rewrite the title of an autobiographical page WITHOUT touching the body.

Rules:
- 2-7 words. Concrete, not formulaic.
- NEVER "The Week When..." / "Неделя, когда..." / "Глава" / "Часть".
- Pull a real word, image, or phrase from the body.
- No colon. No subtitle in the title field.

Return JSON only: { "title": "..." }`;

export const RewriteTitleInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  body: z.string().trim().min(20),
  // Optional hint from the user — e.g. «короче» / «without the place name».
  userInstruction: z.string().trim().max(400).optional()
});
export type RewriteTitleInput = z.infer<typeof RewriteTitleInputSchema>;

const RewriteTitleOutputSchema = z.object({
  title: z.string().trim().min(2).max(120)
});
export type RewriteTitleOutput = z.infer<typeof RewriteTitleOutputSchema>;

export async function rewriteTitle(unsafe: RewriteTitleInput): Promise<RewriteTitleOutput> {
  const input = RewriteTitleInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  // Title-only rewrite is cheap; force it onto the smaller writer-mini.
  const model = process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini";

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Language: ${input.language}\n\nBODY:\n"""\n${input.body}\n"""\n\n` +
          (input.userInstruction ? `USER INSTRUCTION: ${input.userInstruction}\n\n` : "") +
          `Return JSON only: { "title": "..." }`
      }
    ]
  });
  const raw = completion.choices[0]?.message?.content || "";
  return parseWithSchema(raw, RewriteTitleOutputSchema);
}
