import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";
import { EntryOutputSchema, type EntryOutput } from "../schemas.js";

// Sprint 5.3 — Prologue refresh.
//
// After ~8 weekly pages, the user has accumulated material the original
// prologue didn't have access to (because it was written from intake answers
// at week 0). The orchestrator offers a refresh: re-write ALL prologue pages
// using both intake AND the now-visible weekly arc.
//
// This produces N new EntryOutput rows the bot persists as fresh PROLOGUE
// pages with version+1, revisionOfId pointing at the prior prologue page —
// exactly the same versioning shape as Sprint 2's revisePage. The user's
// share token stays attached to the chain.

export const RefreshPrologueInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  // The intake memories the original prologue used.
  intakeMemories: z
    .array(z.object({ type: z.string(), title: z.string(), content: z.string() }))
    .default([]),
  // Existing prologue pages (the bot will pair the new outputs to them by index).
  previousPrologue: z
    .array(z.object({ pageNumber: z.number().int().positive(), title: z.string(), body: z.string() }))
    .min(1),
  // Bodies of the most recent weekly pages — the new material the refresh has to honour.
  recentBodies: z.array(z.object({ title: z.string(), body: z.string() })).default([]),
  writingStyle: z.string().nullable().optional(),
  styleSample: z.string().nullable().optional(),
  narrativeCompass: z.string().nullable().optional()
});
export type RefreshPrologueInput = z.infer<typeof RefreshPrologueInputSchema>;

export const RefreshPrologueOutputSchema = z.object({
  pages: z.array(EntryOutputSchema).min(1)
});
export type RefreshPrologueOutput = z.infer<typeof RefreshPrologueOutputSchema>;

const SYSTEM_PROMPT = `You re-write the multi-page prologue of an autobiographical book.

You have BOTH the original intake material AND the actual weekly pages the
user wrote since. The new prologue is honest about the year as the user has
LIVED it so far, not just as they imagined it at the start.

Rules:
- Same number of pages as the previous prologue.
- Each page is one scene, 200-280 words.
- First person, in the user's language.
- Re-use the strong concrete images from the previous prologue when they
  still hold; replace them when the weekly arc has revealed something more
  honest.
- Never invent facts.
- No SaaS-speak.
Return only valid JSON: { "pages": [ <EntryOutput>, ... ] }`;

export async function refreshPrologue(unsafe: RefreshPrologueInput): Promise<RefreshPrologueOutput> {
  const input = RefreshPrologueInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_WRITER_MODEL || "gpt-4.1";

  const previousBlock = input.previousPrologue
    .map((p) => `--- previous page ${p.pageNumber} — "${p.title}" ---\n${p.body}`)
    .join("\n\n");
  const recentBlock = input.recentBodies
    .slice(-6)
    .map((p, i) => `--- recent weekly ${i + 1} — "${p.title}" ---\n${p.body.slice(0, 1500)}`)
    .join("\n\n");
  const intakeBlock = input.intakeMemories
    .map((m) => `- [${m.type}] ${m.title}: ${m.content}`)
    .join("\n");

  const userPrompt = `Language: ${input.language}
${input.writingStyle ? `Voice: ${input.writingStyle}` : ""}
${input.styleSample ? `Style sample (match this voice): "${input.styleSample}"` : ""}
${input.narrativeCompass ? `Central question of the year: ${input.narrativeCompass}` : ""}

INTAKE MEMORIES (the foundation):
${intakeBlock || "(none)"}

PREVIOUS PROLOGUE PAGES (your earlier output — the new versions replace these):
${previousBlock}

RECENT WEEKLY PAGES (what the user has actually lived since the original prologue):
${recentBlock || "(none yet)"}

Produce ${input.previousPrologue.length} new prologue pages, one per previous
page (same order). Return JSON only:
{ "pages": [ { "title": "...", "body": "...", "quote": "..." | null, "teaser": "...", "pageSummary": "...", "mood": ["..."], "tags": ["..."], "memoryUpdates": [] }, ... ] }`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.55,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ]
  });
  const raw = completion.choices[0]?.message?.content || "";
  return parseWithSchema(raw, RefreshPrologueOutputSchema);
}
