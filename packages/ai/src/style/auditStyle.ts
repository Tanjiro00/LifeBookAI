import { z } from "zod";
import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";

// Sprint 5.4 — Style auditor.
//
// Every 5 pages the styleAudit queue compares the most recent pages to the
// styleSample (if set) and to the user's stated writingStyle. The auditor
// produces a short recalibration note that the writer prompt picks up next
// time it generates a page.
//
// The note is small and surgical: «pages 14-18 lean a touch more rhetorical
// than pages 1-13; nudge back toward the styleSample's quieter register».
// We do NOT ask the writer to overhaul itself — just bias the next page.

export const StyleAuditInputSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  writingStyle: z.string().nullable().optional(),
  styleSample: z.string().nullable().optional(),
  // Most recent N page bodies (in chronological order).
  recentBodies: z.array(z.string().min(20)).min(2)
});
export type StyleAuditInput = z.infer<typeof StyleAuditInputSchema>;

export const StyleAuditOutputSchema = z.object({
  // 0–280 char nudge for the writer prompt. null when no drift detected.
  recalibration: z.string().trim().min(10).max(280).nullable(),
  driftScore: z.number().min(0).max(1)
});
export type StyleAuditOutput = z.infer<typeof StyleAuditOutputSchema>;

const SYSTEM_PROMPT = `You audit the prose voice of a personal autobiographical book.

Compare the user's stated voice (writingStyle / styleSample) against their last
few pages. If the recent pages drift toward generic, rhetorical, or moralising
prose — produce a SHORT recalibration note (≤ 280 chars) describing the drift
and how to gently correct it. If the voice is on-key, return null.

Rules:
- The note is read by the page writer, not the user. Be terse and concrete.
- NEVER recommend a stylistic flip ("write more poetically"). Only nudge back
  toward the styleSample's register.
- driftScore: 0.0 = perfect alignment, 1.0 = severe drift. Use the number even
  when recalibration is null (it'll be near 0).
Return only valid JSON.`;

export async function auditStyle(unsafe: StyleAuditInput): Promise<StyleAuditOutput> {
  const input = StyleAuditInputSchema.parse(unsafe);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_VALIDATOR_MODEL || "gpt-4.1-mini";

  const recent = input.recentBodies
    .slice(-5)
    .map((b, i) => `--- recent ${i + 1} ---\n${b.slice(0, 1500)}`)
    .join("\n\n");

  const userPrompt = `Language: ${input.language}
${input.writingStyle ? `User's stated writingStyle: "${input.writingStyle}"` : ""}
${input.styleSample ? `Style sample (target voice): "${input.styleSample}"` : ""}

RECENT PAGES (audit these against the target voice):
${recent}

Return JSON: { "recalibration": "..." | null, "driftScore": 0..1 }`;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ]
  });
  const raw = completion.choices[0]?.message?.content || "";
  return parseWithSchema(raw, StyleAuditOutputSchema);
}
