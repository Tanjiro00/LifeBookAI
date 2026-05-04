import { PRIVATE_BIOGRAPHER_SYSTEM_PROMPT, buildChapterPrompt } from "./prompts.js";
import { parseWithSchema } from "./json.js";
import { getOpenAiClient, shouldUseMockAi } from "./openaiClient.js";
import { mockChapter } from "./mock.js";
import {
  ChapterOutputSchema,
  GenerateChapterInputSchema,
  type ChapterOutput,
  type GenerateChapterInput
} from "./schemas.js";

export async function generateChapter(unsafeInput: GenerateChapterInput): Promise<ChapterOutput> {
  const input = GenerateChapterInputSchema.parse(unsafeInput);

  if (shouldUseMockAi()) {
    return mockChapter(input);
  }

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
  const prompt = buildChapterPrompt(input);
  let lastRaw = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const completion = await client.chat.completions.create({
      model,
      temperature: attempt === 1 ? 0.72 : 0.25,
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
      return parseWithSchema(lastRaw, ChapterOutputSchema);
    } catch {
      if (attempt === 3) {
        break;
      }
    }
  }

  throw new Error(`Failed to generate a valid chapter. Last response length: ${lastRaw.length}`);
}

