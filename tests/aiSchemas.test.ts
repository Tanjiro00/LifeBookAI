import { describe, expect, it } from "vitest";
import { ChapterOutputSchema, ClarifyingQuestionsOutputSchema } from "@lifebook/ai";

describe("AI schema validation", () => {
  it("accepts valid clarifying questions", () => {
    const parsed = ClarifyingQuestionsOutputSchema.parse({
      questions: [
        { question: "Что именно изменилось после этого разговора?", reason: "Уточняет поворотный момент." },
        { question: "Какую деталь ты хочешь запомнить?", reason: "Добавляет конкретику." }
      ]
    });

    expect(parsed.questions).toHaveLength(2);
  });

  it("rejects chapters that are too thin", () => {
    const result = ChapterOutputSchema.safeParse({
      title: "Неделя",
      content: "Слишком коротко.",
      mood: [],
      tags: [],
      people: [],
      places: [],
      keyEvents: [],
      memoryUpdates: []
    });

    expect(result.success).toBe(false);
  });

  it("normalizes optional metadata", () => {
    const parsed = ChapterOutputSchema.parse({
      title: "Неделя, которую я запомнил",
      subtitle: null,
      summary: null,
      quote: null,
      content:
        "Эта неделя началась с обычных дел, но постепенно стала важной. Я заметил несколько деталей, которые обычно теряются в шуме дней, и решил сохранить их здесь, без лишней драматизации, но с вниманием к тому, что действительно произошло.",
      mood: ["reflective", "reflective"],
      tags: ["week"],
      people: [],
      places: [],
      keyEvents: ["важный разговор"],
      memoryUpdates: []
    });

    expect(parsed.subtitle).toBeUndefined();
    expect(parsed.mood).toEqual(["reflective"]);
  });
});

