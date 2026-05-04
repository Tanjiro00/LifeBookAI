import { PRIVATE_BIOGRAPHER_SYSTEM_PROMPT, buildClarifyingQuestionsPrompt } from "./prompts.js";
import { parseWithSchema } from "./json.js";
import { getOpenAiClient, shouldUseMockAi } from "./openaiClient.js";
import { mockClarifyingQuestions } from "./mock.js";
import {
  ClarifyingQuestionsOutputSchema,
  GenerateClarifyingQuestionsInputSchema,
  type ClarifyingQuestionsOutput,
  type GenerateClarifyingQuestionsInput
} from "./schemas.js";

export async function generateClarifyingQuestions(
  unsafeInput: GenerateClarifyingQuestionsInput
): Promise<ClarifyingQuestionsOutput> {
  const input = GenerateClarifyingQuestionsInputSchema.parse(unsafeInput);

  if (shouldUseMockAi()) {
    return mockClarifyingQuestions(input);
  }

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
  const prompt = buildClarifyingQuestionsPrompt(input);
  let lastRaw = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const completion = await client.chat.completions.create({
      model,
      temperature: attempt === 1 ? 0.55 : 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PRIVATE_BIOGRAPHER_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            attempt === 1
              ? prompt
              : `${prompt}\n\nYour previous response was invalid. Return only valid JSON matching the exact schema.`
        }
      ]
    });

    lastRaw = completion.choices[0]?.message?.content || "";
    try {
      return parseWithSchema(lastRaw, ClarifyingQuestionsOutputSchema);
    } catch {
      if (attempt === 3) {
        break;
      }
    }
  }

  throw new Error(`Failed to generate valid clarifying questions. Last response length: ${lastRaw.length}`);
}

