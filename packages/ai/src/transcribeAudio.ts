import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { shouldUseMockAi, getOpenAiClient } from "./openaiClient.js";
import { TranscriptionOutputSchema, type TranscriptionOutput } from "./schemas.js";

export async function transcribeAudio(filePath: string): Promise<TranscriptionOutput> {
  if (shouldUseMockAi()) {
    return {
      transcript: `Мок-расшифровка файла ${basename(filePath)}. Рассказывал(а) о неделе, усталости, важном разговоре и желании сохранить этот момент.`,
      language: "ru",
      confidence: 0.7
    };
  }

  const client = getOpenAiClient();
  const model = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
  const result = await client.audio.transcriptions.create({
    file: createReadStream(filePath),
    model,
    response_format: "json"
  });

  return TranscriptionOutputSchema.parse({
    transcript: result.text,
    language: "language" in result ? result.language : undefined,
    durationSeconds: "duration" in result ? result.duration : undefined
  });
}

