import { createHash } from "node:crypto";
import { getOpenAiClient } from "./openaiClient.js";

// Sprint 1.2 — Embedding primitive.
//
// Lives in @lifebook/ai (not in apps/bot) because both the runtime job and the
// CLI backfill script need to call it. This file deliberately knows nothing
// about Prisma — the persistence layer (apps/bot/src/services/embeddingService.ts)
// owns DB writes.

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export type EmbedResult = {
  embedding: number[];
  model: string;
  dimensions: number;
  bodyHash: string;
};

export function hashBody(body: string): string {
  // SHA-256 of the normalized body. Whitespace-collapsed so trivial reformatting
  // doesn't bust the cache; case-preserving because case can change meaning.
  const normalized = body.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export async function embedText(opts: {
  text: string;
  model?: string;
  dimensions?: number;
}): Promise<EmbedResult> {
  const text = opts.text.trim();
  if (!text) {
    throw new Error("embedText: empty input");
  }
  const model = opts.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const dimensions =
    opts.dimensions ??
    (process.env.OPENAI_EMBEDDING_DIMENSIONS
      ? Number.parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS, 10)
      : DEFAULT_EMBEDDING_DIMENSIONS);
  const bodyHash = hashBody(text);

  const client = getOpenAiClient();
  // OpenAI's text-embedding-3-* family supports a `dimensions` param to truncate
  // the output. We always pass it so the column dim and the API output match.
  const response = await client.embeddings.create({
    model,
    input: text,
    dimensions
  });
  const data = response.data[0];
  if (!data?.embedding) {
    throw new Error("embedText: no embedding returned");
  }
  return {
    embedding: data.embedding,
    model,
    dimensions: data.embedding.length,
    bodyHash
  };
}
