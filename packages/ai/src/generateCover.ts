import { buildCoverPrompt } from "./prompts.js";
import { getOpenAiClient } from "./openaiClient.js";
import { GenerateCoverInputSchema, type GenerateCoverInput } from "./schemas.js";

export type CoverImageResult = {
  imageBase64: string;
  promptUsed: string;
};

// Generates a hardcover-jacket-style image via OpenAI's image API. We persist the
// resulting PNG ourselves; this function only returns base64 so the caller can store it.
export async function generateCover(unsafe: GenerateCoverInput): Promise<CoverImageResult | null> {
  const input = GenerateCoverInputSchema.parse(unsafe);
  const promptUsed = buildCoverPrompt(input.themes, input.mood, input.bookTitle);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

  try {
    const response = await client.images.generate({
      model,
      prompt: promptUsed,
      size: "1024x1536", // 2:3, jacket aspect
      n: 1
    });
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) return null;
    return { imageBase64: b64, promptUsed };
  } catch {
    return null;
  }
}

// Sprint 5.6 — Pro tier: generate N cover variants in one API call so the user
// can pick. n is clamped to [1, 4] — OpenAI's image API supports up to 10 but
// quality drops past 4 and tokens cost rises linearly.
export async function generateCoverVariants(
  unsafe: GenerateCoverInput,
  n: number
): Promise<CoverImageResult[]> {
  const input = GenerateCoverInputSchema.parse(unsafe);
  const count = Math.max(1, Math.min(4, Math.round(n)));
  const promptUsed = buildCoverPrompt(input.themes, input.mood, input.bookTitle);

  const client = getOpenAiClient();
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  try {
    const response = await client.images.generate({
      model,
      prompt: promptUsed,
      size: "1024x1536",
      n: count
    });
    return (response.data ?? [])
      .map((d) => d.b64_json)
      .filter((b): b is string => Boolean(b))
      .map((imageBase64) => ({ imageBase64, promptUsed }));
  } catch {
    return [];
  }
}
