import { parseWithSchema } from "../json.js";
import { getOpenAiClient } from "../openaiClient.js";
import { detectContentLanguage } from "../language.js";
import { EntryOutputSchema, type EntryOutput, type GenerateEntryInput } from "../schemas.js";
import { PAGE_WRITER_SYSTEM_PROMPT, buildPageWriterPrompt } from "../prompts/pageWriterPrompt.js";
import type { EntryPlan } from "./planEntry.js";

// Sprint 2.2 — Writer.
//
// Receives the user's input + the EntryPlan from Sprint 2.1 + the manuscript
// context (recent/related/prologue bodies). Renders prose that follows the
// plan: the central scene, the factualBoundaries verbatim, exactly the
// continuityMoves the planner approved.
//
// On parse failure the writer self-repairs once with an explicit "your previous
// JSON didn't conform" hint. After three strict passes we throw — there is no
// mock fallback; a real LLM response is the only acceptable output for a user's
// autobiographical page.

export type WritePageInput = GenerateEntryInput & { plan: EntryPlan };

export async function writePage(unsafeInput: WritePageInput): Promise<EntryOutput> {
  // Language detection rule: trust the caller when it passed a known language.
  // We re-detect only when the caller left it unspecified. This matters during
  // repair retries, where the rawEntry text is augmented with editorial notes
  // in English that would otherwise flip detection on Cyrillic inputs.
  const explicit = (unsafeInput.language || "").toLowerCase();
  const language: "ru" | "en" =
    explicit.startsWith("ru") || explicit.startsWith("en")
      ? (explicit.startsWith("en") ? "en" : "ru")
      : detectContentLanguage(unsafeInput.rawEntryOrTranscript, unsafeInput.language);

  const client = getOpenAiClient();
  // Strict-first temperature: previous order (creative-first) optimised for
  // expressive prose at the cost of JSON validity, which made retries common
  // and dropped quality. We start strict (0.5) and unlock a hair on retries.
  const model = process.env.OPENAI_WRITER_MODEL || "gpt-4.1";
  const userPrompt = buildPageWriterPrompt({ ...unsafeInput, language });
  let lastRaw = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const completion = await client.chat.completions.create({
      model,
      temperature: attempt === 1 ? 0.5 : 0.65,
      top_p: 0.92,
      presence_penalty: 0.4,
      frequency_penalty: 0.3,
      response_format: { type: "json_object" },
      messages: [
        // Static prompts FIRST → maximises prompt-cache hits across users.
        { role: "system", content: PAGE_WRITER_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            attempt === 1
              ? userPrompt
              : `${userPrompt}\n\nYour previous response was invalid JSON or missed the schema. Return only valid JSON now.`
        }
      ]
    });
    lastRaw = completion.choices[0]?.message?.content || "";
    try {
      return parseWithSchema(lastRaw, EntryOutputSchema);
    } catch {
      if (attempt === 3) break;
    }
  }
  throw new Error(`writePage: failed to produce valid output after 3 attempts. Last response length: ${lastRaw.length}`);
}
