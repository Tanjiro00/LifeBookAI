import { PRIVATE_BIOGRAPHER_SYSTEM_PROMPT, buildStyleAdjustmentPrompt } from "./prompts.js";
import { parseWithSchema } from "./json.js";
import { getOpenAiClient, shouldUseMockAi } from "./openaiClient.js";
import { mockAdjustedChapter } from "./mock.js";
import {
  AdjustChapterInputSchema,
  ChapterOutputSchema,
  type AdjustChapterInput,
  type ChapterOutput
} from "./schemas.js";

export async function adjustChapterStyle(unsafeInput: AdjustChapterInput): Promise<ChapterOutput> {
  const input = AdjustChapterInputSchema.parse(unsafeInput);

  if (shouldUseMockAi()) {
    return mockAdjustedChapter(input.chapter, input.styleAdjustment);
  }

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
  const prompt = buildStyleAdjustmentPrompt(input);
  let lastRaw = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const completion = await client.chat.completions.create({
      model,
      temperature: attempt === 1 ? 0.58 : 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PRIVATE_BIOGRAPHER_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            attempt === 1
              ? prompt
              : `${prompt}\n\nYour previous response was invalid. Return only valid JSON matching the original schema.`
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

  throw new Error(`Failed to adjust chapter style. Last response length: ${lastRaw.length}`);
}

