import { createReadStream } from "node:fs";
import { getOpenAiClient } from "./openaiClient.js";
import { TranscriptionOutputSchema, type TranscriptionOutput } from "./schemas.js";

export async function transcribeAudio(filePath: string): Promise<TranscriptionOutput> {
  const client = getOpenAiClient();
  const primaryModel = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";

  // Try the configured model first; if it rejects the file format (some newer
  // transcribe models are stricter about .oga/.ogg vs whisper-1's permissive list),
  // fall back to whisper-1 which accepts everything Telegram emits.
  async function call(model: string) {
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

  try {
    return await call(primaryModel);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isFormatError = /Unsupported file format|invalid_request_error|400/i.test(msg);
    if (!isFormatError || primaryModel === "whisper-1") {
      throw err;
    }
    return await call("whisper-1");
  }
}
