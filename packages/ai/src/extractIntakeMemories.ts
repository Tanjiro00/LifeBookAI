import { z } from "zod";
import { parseWithSchema } from "./json.js";
import { getOpenAiClient } from "./openaiClient.js";
import { MemoryUpdateSchema } from "./schemas.js";

export const IntakeQuestionKindSchema = z.enum([
  "ORIGIN",         // Q1: childhood, where you grew up
  "INFLUENCE",      // Q2: people who shaped you
  "TURNING_POINT",  // Q3: pre-year life turning point
  "COMPANIONS",     // Q4: 3-5 key current people
  "CURRENT_LIFE",   // Q5: what you're living right now / direction of the year
  "FEAR_DREAM",     // Q6: biggest fear + biggest dream
  "VOICE"           // Q7: voice for the book — handled separately, no memory output
]);
export type IntakeQuestionKind = z.infer<typeof IntakeQuestionKindSchema>;

export const ExtractIntakeInputSchema = z.object({
  kind: IntakeQuestionKindSchema,
  answer: z.string().trim().min(1),
  language: z.string().optional().default("ru")
});
export type ExtractIntakeInput = z.infer<typeof ExtractIntakeInputSchema>;

export const ExtractIntakeOutputSchema = z.object({
  memories: z.array(MemoryUpdateSchema).max(6)
});
export type ExtractIntakeOutput = z.infer<typeof ExtractIntakeOutputSchema>;

const SYSTEM_PROMPT = `You extract structured biographical facts from one onboarding answer.
You are NOT writing prose, NOT interpreting feelings, NOT inventing details.
Each memory must be something the user literally stated.
Confidence is always 0.95 because the user told you directly.
Only emit memories if there's a concrete fact (a person's name, a place, an event, a stated fear/goal/preference).
Empty list is valid.
Return only valid JSON.`;

function memoryHints(kind: IntakeQuestionKind): string {
  switch (kind) {
    case "ORIGIN":
      return "Expected types: PLACE (where they grew up), LIFE_EVENT (a defining childhood event), THEME (a quality of their childhood).";
    case "INFLUENCE":
      return "Expected types: PERSON (who shaped them), THEME (the kind of influence).";
    case "TURNING_POINT":
      return "Expected types: LIFE_EVENT, THEME.";
    case "COMPANIONS":
      return "Expected types: PERSON for each named person. One memory per person.";
    case "CURRENT_LIFE":
      return "Expected types: THEME (what they're living through), GOAL (where the year is heading).";
    case "FEAR_DREAM":
      return "Expected types: FEAR (what they're afraid of losing), GOAL (what they dream of).";
    case "VOICE":
      return "Voice is handled outside memory; return an empty list.";
  }
}

function buildPrompt(input: ExtractIntakeInput): string {
  return `User's answer to onboarding question kind="${input.kind}":
"""
${input.answer}
"""

${memoryHints(input.kind)}

Language: ${input.language}

Return JSON only:
{
  "memories": [
    { "type": "PERSON", "title": "...", "content": "...", "confidence": 0.95 }
  ]
}

Rules:
- title: short noun phrase, 2-8 words.
- content: 1-2 sentences in the same language, factual, in the user's voice.
- type must be one of: PERSON, PLACE, THEME, LIFE_EVENT, GOAL, FEAR, ACHIEVEMENT, PREFERENCE.
- Only include facts the user explicitly stated. No inference about feelings.
- 0 to 6 memories. Empty list if there's nothing concrete to record.`;
}

export async function extractIntakeMemories(unsafe: ExtractIntakeInput): Promise<ExtractIntakeOutput> {
  const input = ExtractIntakeInputSchema.parse(unsafe);
  if (input.kind === "VOICE") return { memories: [] };

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(input) }
      ]
    });
    const raw = completion.choices[0]?.message?.content || "";
    return parseWithSchema(raw, ExtractIntakeOutputSchema);
  } catch {
    // If the LLM call fails or returns bad JSON, return an empty memory list
    // rather than fabricating one. The intake question's text answer is still
    // stored on the Entry — we just don't extract structured memories for it.
    return { memories: [] };
  }
}
