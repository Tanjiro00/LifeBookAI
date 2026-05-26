import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";

// Sprint 3.3 — Memory merge LLM.
//
// When new evidence about a person/place/theme arrives that already has a
// MemoryEntity, we ask the model: «here's what we knew, here's the new
// evidence — produce the new currentSummary». The model also classifies the
// change so reviewers can see «is this a contradiction or just more detail?».
//
// Crucially: do NOT overwrite older facts. The output should READ AS IF the
// new evidence were a known truth all along, while preserving anything the
// previous summary asserted. If the new evidence contradicts an older fact,
// the changeType=contradict signals that the user should be asked to confirm
// (Sprint 3.7's «Я запомнил» follow-up).

export const MergeMemoryInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  type: z.string(), // PERSON, PLACE, THEME, etc.
  canonicalName: z.string().trim().min(1),
  // The CURRENT summary in storage (the old `Memory.content` if any).
  existingSummary: z.string().nullable().optional(),
  // Aliases collected so far (other surface names seen).
  knownAliases: z.array(z.string()).default([]),
  // Whatever the writer/planner saw in the new page that justifies updating
  // the memory. Plain prose; the model should read this as the user's own
  // words.
  newEvidence: z.string().trim().min(2),
  newEvidencePageId: z.string().optional()
});
export type MergeMemoryInput = z.infer<typeof MergeMemoryInputSchema>;

export const MergeMemoryOutputSchema = z.object({
  // The new currentSummary (80-260 words). MUST not lose previous detail.
  newSummary: z.string().trim().min(20).max(2000),
  changeType: z.enum(["confirm", "add_detail", "contradict", "evolve"]),
  confidence: z.number().min(0).max(1).default(0.85),
  // If the new evidence introduces a new alias the system should remember
  // (e.g. user wrote "бабуля" today but the entity title was "бабушка"),
  // the model surfaces it. memoryReviewService merges these into the row.
  newAliases: z.array(z.string()).max(4).default([])
});
export type MergeMemoryOutput = z.infer<typeof MergeMemoryOutputSchema>;

const SYSTEM_PROMPT = `You update a biographical memory record from new evidence.

You receive: an existing summary about an entity (person, place, theme), plus a
new piece of evidence the user just wrote. Produce the new currentSummary.

Rules:
- Preserve every concrete fact already in the existing summary unless the new
  evidence clearly contradicts it. Even if it contradicts, retain the old fact
  in a parenthetical or in past tense — the book is a record of how things
  were and are.
- Add the new detail naturally; do NOT prepend "Update:" or "Edit:" markers.
- Stay in the same language as the existing summary (or the new evidence if
  no existing summary).
- 80–260 words. Prose, not a list.
- changeType:
  * confirm    — new evidence is consistent and adds nothing material.
  * add_detail — new evidence brings new concrete detail (preferred).
  * contradict — new evidence directly contradicts an asserted fact.
  * evolve     — situation has changed (e.g. relationship status, location).
- If the user's surface name for the entity differs from the canonicalName
  (e.g. "бабуля" vs "бабушка"), surface it in newAliases.

Return only valid JSON matching the schema.`;

export async function mergeMemory(unsafe: MergeMemoryInput): Promise<MergeMemoryOutput> {
  const input = MergeMemoryInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_PLANNER_MODEL || "gpt-4.1-mini";

  const userPrompt = `Language: ${input.language}
Entity type: ${input.type}
Canonical name: "${input.canonicalName}"
Known aliases: ${input.knownAliases.length ? input.knownAliases.join(", ") : "(none)"}

Existing summary:
${input.existingSummary ? `"""\n${input.existingSummary}\n"""` : "(none — this is the first time we know about this entity)"}

New evidence (from a page the user just wrote):
"""
${input.newEvidence}
"""

Return JSON only: { "newSummary": "...", "changeType": "...", "confidence": 0..1, "newAliases": ["..."] }`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ]
  });
  const raw = completion.choices[0]?.message?.content || "";
  return parseWithSchema(raw, MergeMemoryOutputSchema);
}
