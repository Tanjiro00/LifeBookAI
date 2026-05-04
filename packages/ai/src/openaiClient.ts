import OpenAI from "openai";

let client: OpenAI | undefined;

export function getOpenAiClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  return client;
}

export function shouldUseMockAi(): boolean {
  return process.env.AI_PROVIDER === "mock" || !process.env.OPENAI_API_KEY;
}

