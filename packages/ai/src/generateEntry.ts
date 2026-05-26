import { PRIVATE_BIOGRAPHER_SYSTEM_PROMPT, buildEntryPrompt } from "./prompts.js";
import { parseWithSchema } from "./json.js";
import { getOpenAiClient } from "./openaiClient.js";
import { detectContentLanguage } from "./language.js";
import { EntryOutputSchema, GenerateEntryInputSchema, type EntryOutput, type GenerateEntryInput } from "./schemas.js";

export async function generateEntry(unsafeInput: GenerateEntryInput): Promise<EntryOutput> {
  const input = GenerateEntryInputSchema.parse(unsafeInput);
  const language = detectContentLanguage(input.rawEntryOrTranscript, input.language);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4.1";
  const prompt = buildEntryPrompt({ ...input, language });
  let lastRaw = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const completion = await client.chat.completions.create({
      model,
      temperature: attempt === 1 ? 0.78 : 0.4,
      top_p: 0.92,
      presence_penalty: 0.4,
      frequency_penalty: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PRIVATE_BIOGRAPHER_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            attempt === 1
              ? prompt
              : `${prompt}\n\nYour previous response was invalid JSON or missed the schema. Return only valid JSON now.`
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

  throw new Error(`Failed to generate a valid entry. Last response length: ${lastRaw.length}`);
}
