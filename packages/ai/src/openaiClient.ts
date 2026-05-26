import OpenAI from "openai";

// Mock paths were removed from the service. Every AI call now hits OpenAI;
// if OPENAI_API_KEY is missing, getOpenAiClient() throws on first use and
// the bot surfaces a real error. This is intentional — fake biographical
// content must never appear in a user's manuscript.

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

