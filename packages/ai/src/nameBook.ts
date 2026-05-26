import { PRIVATE_BIOGRAPHER_SYSTEM_PROMPT, buildNameBookPrompt } from "./prompts.js";
import { parseWithSchema } from "./json.js";
import { getOpenAiClient } from "./openaiClient.js";
import {
  NameBookInputSchema,
  NameBookOutputSchema,
  type NameBookInput,
  type NameBookOutput
} from "./schemas.js";

export async function nameBook(unsafeInput: NameBookInput): Promise<NameBookOutput> {
  const input = NameBookInputSchema.parse(unsafeInput);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1";
  const prompt = buildNameBookPrompt(input);
  let lastRaw = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const completion = await client.chat.completions.create({
      model,
      temperature: attempt === 1 ? 0.6 : 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PRIVATE_BIOGRAPHER_SYSTEM_PROMPT },
        {
          role: "user",
          content: attempt === 1 ? prompt : `${prompt}\n\nReturn valid JSON only.`
        }
      ]
    });
    lastRaw = completion.choices[0]?.message?.content || "";
    try {
      return parseWithSchema(lastRaw, NameBookOutputSchema);
    } catch {
      if (attempt === 2) break;
    }
  }
  // Both attempts failed to parse. Throw — bookComposer's catch falls back to
  // the user's current Book.title (already set in onboarding) and the
  // name-book job retries on the next milestone. We never make up a title.
  throw new Error(
    `nameBook: failed to produce valid JSON after 2 attempts. Last response length: ${lastRaw.length}`
  );
}
