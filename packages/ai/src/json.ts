import type { z } from "zod";

export class AiJsonError extends Error {
  constructor(
    message: string,
    public readonly rawOutput?: string
  ) {
    super(message);
    this.name = "AiJsonError";
  }
}

export function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new AiJsonError("AI did not return a JSON object.", raw);
    }

    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (error) {
      throw new AiJsonError("AI returned invalid JSON.", raw);
    }
  }
}

export function parseWithSchema<S extends z.ZodTypeAny>(raw: string, schema: S): z.output<S> {
  const json = parseJsonObject(raw);
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AiJsonError(result.error.message, raw);
  }
  return result.data;
}
