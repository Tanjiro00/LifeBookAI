import { PRIVATE_BIOGRAPHER_SYSTEM_PROMPT, buildNameBookPrompt } from "./prompts.js";
import { parseWithSchema } from "./json.js";
import { getOpenAiClient, shouldUseMockAi } from "./openaiClient.js";
import {
  NameBookInputSchema,
  NameBookOutputSchema,
  type NameBookInput,
  type NameBookOutput
} from "./schemas.js";

export async function nameBook(unsafeInput: NameBookInput): Promise<NameBookOutput> {
  const input = NameBookInputSchema.parse(unsafeInput);

  if (shouldUseMockAi()) {
    return mockNameBook(input);
  }

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
      if (attempt === 2) return mockNameBook(input);
    }
  }
  return mockNameBook(input);
}

function mockNameBook(input: NameBookInput): NameBookOutput {
  const language = (input.language || "ru").toLowerCase();
  if (language.startsWith("en")) {
    return { title: "What I Kept", subtitle: "fifty-two weeks, one voice" };
  }
  // Pick a fragment from the first entry's title to feel less generic.
  const fragment = input.entries[0]?.title.split(/[\s,—]/).find((w) => w.length >= 4) || "Год";
  return { title: `Книга про ${fragment.toLowerCase()}`, subtitle: "пятьдесят две недели, один голос" };
}
