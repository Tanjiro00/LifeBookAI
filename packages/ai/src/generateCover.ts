import { buildCoverPrompt } from "./prompts.js";
import { getOpenAiClient, shouldUseMockAi } from "./openaiClient.js";
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

  if (shouldUseMockAi()) {
    return null; // Mock mode: no image. Caller will fall back to typographic placeholder.
  }

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
