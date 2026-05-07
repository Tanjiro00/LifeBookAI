import { describe, expect, it } from "vitest";
import { EntryOutputSchema, GenerateEntryInputSchema, NameBookOutputSchema } from "../packages/ai/src/schemas.js";

describe("EntryOutput schema", () => {
  it("accepts a valid entry", () => {
    const parsed = EntryOutputSchema.parse({
      title: "Тихий понедельник",
      body: "Эта неделя началась обычно — кофе на кухне, утренний свет, разговор с собой про то, что вечер прошёл слишком быстро.",
      quote: null,
      mood: ["quiet"],
      tags: ["неделя"],
      memoryUpdates: []
    });
    expect(parsed.title).toBe("Тихий понедельник");
  });

  it("rejects too-short body", () => {
    const r = EntryOutputSchema.safeParse({
      title: "ok",
      body: "слишком коротко",
      mood: [],
      tags: []
    });
    expect(r.success).toBe(false);
  });
});

describe("GenerateEntryInput schema", () => {
  it("requires positive entryNumber", () => {
    const r = GenerateEntryInputSchema.safeParse({
      rawEntryOrTranscript: "Что-то произошло на этой неделе.",
      entryNumber: 0
    });
    expect(r.success).toBe(false);
  });

  it("accepts minimal valid input", () => {
    const r = GenerateEntryInputSchema.safeParse({
      rawEntryOrTranscript: "Что-то произошло на этой неделе.",
      entryNumber: 1
    });
    expect(r.success).toBe(true);
  });
});

describe("NameBookOutput schema", () => {
  it("accepts title with optional subtitle", () => {
    expect(() => NameBookOutputSchema.parse({ title: "Книга про кофе", subtitle: null })).not.toThrow();
    expect(() => NameBookOutputSchema.parse({ title: "What I Kept", subtitle: "fifty-two weeks" })).not.toThrow();
  });
});
