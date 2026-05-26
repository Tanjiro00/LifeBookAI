import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";
import { EntryOutputSchema, type EntryOutput } from "../schemas.js";

// Sprint 2.6 — Point revision.
//
// Takes the current Page body + a user instruction («replace the second
// paragraph», «I was angry, not sad», «remove the dialogue») and returns a
// REVISED body. Preserves everything the user did not explicitly ask to
// change. The user's correction is authoritative — if they say a fact was
// different, the new body adopts that fact.

export const REVISION_SYSTEM_PROMPT = `You revise an existing autobiographical page according to the user's instruction.

Rules:
- Preserve everything the user did not ask to change. Same paragraphs, same voice,
  same images — except where the instruction says otherwise.
- If the user corrects a fact (a name, a place, a feeling, a date), the correction
  is authoritative. Adjust the body so the corrected fact reads as if it had been
  the truth all along.
- Do NOT introduce new facts, new dialogue, or new metaphors that the user didn't
  ask for.
- Keep the title unless the user asked to change it.
- Keep the page short and quiet; this is a revision, not a rewrite.
- Return a FULL revised page, not a diff.

Output: JSON exactly matching the schema. No markdown.`;

export const RevisePageInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  // The current page state.
  previous: z.object({
    title: z.string(),
    body: z.string(),
    quote: z.string().nullable().optional(),
    teaser: z.string().nullable().optional(),
    pageSummary: z.string().nullable().optional(),
    mood: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([])
  }),
  userInstruction: z.string().trim().min(2).max(2000)
});
export type RevisePageInput = z.infer<typeof RevisePageInputSchema>;

export async function revisePage(unsafe: RevisePageInput): Promise<EntryOutput> {
  const input = RevisePageInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_WRITER_MODEL || "gpt-4.1";

  const userPrompt = buildRevisionPrompt(input);

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.4,
    top_p: 0.9,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: REVISION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ]
  });
  const raw = completion.choices[0]?.message?.content || "";
  return parseWithSchema(raw, EntryOutputSchema);
}

function buildRevisionPrompt(input: RevisePageInput): string {
  const prev = input.previous;
  return `Language: ${input.language}

PREVIOUS PAGE (the version the user is correcting):
title: ${prev.title}
body:
"""
${prev.body}
"""
${prev.quote ? `quote: ${prev.quote}\n` : ""}${prev.teaser ? `teaser: ${prev.teaser}\n` : ""}${prev.pageSummary ? `pageSummary: ${prev.pageSummary}\n` : ""}mood: ${prev.mood.join(", ") || "(none)"}
tags: ${prev.tags.join(", ") || "(none)"}

USER INSTRUCTION (authoritative):
"""
${input.userInstruction}
"""

Return JSON only with the same shape as a normal page output:
{
  "title": "...",
  "body": "...",
  "quote": "..." | null,
  "teaser": "...",
  "pageSummary": "...",
  "mood": ["..."],
  "tags": ["..."],
  "memoryUpdates": []
}

Rules reminder:
- Preserve everything not explicitly changed.
- The user's correction overrides the previous body's facts.
- No new metaphors, no new dialogue, no new SaaS-speak.
- Body word count: stay close to the original (±15%).`;
}
