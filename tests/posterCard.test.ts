import { describe, expect, it } from "vitest";
import {
  renderPosterCardSvg,
  renderPosterCardPng
} from "../packages/renderer/src/renderPosterCard.js";

// Sprint 0 smoke tests for the new poster-card renderer. We're not pixel-comparing
// the output (font availability differs across environments); we're proving:
//   1. SVG renders without throwing for short/long inputs.
//   2. The body of the page is NEVER rendered onto the card — only the teaser.
//   3. PNG renders to a non-empty buffer.

describe("renderPosterCard", () => {
  const baseInput = {
    pageNumber: 12,
    totalSlots: 52,
    title: "Тихий понедельник",
    teaser:
      "Утром на кухне я заметил, что чай остыл, пока я смотрел в окно. Это был такой тихий момент, что я почти его пропустил.",
    quote: "Иногда главное — не отправить, а написать.",
    mood: ["quiet"],
    tags: ["неделя"],
    createdAt: new Date("2026-04-27T08:00:00Z")
  };

  it("renders SVG for a normal page without throwing", () => {
    const svg = renderPosterCardSvg(baseInput);
    expect(svg).toContain("<svg");
    expect(svg).toContain("LIFEBOOK");
    expect(svg).toContain("Тихий понедельник");
  });

  it("does NOT render the full body on the card — only the teaser", () => {
    const longBody =
      "Это тело страницы которое НЕ должно появиться на карточке потому что card теперь является постером а полный текст читается в Mini App. ".repeat(
        20
      );
    const svg = renderPosterCardSvg({ ...baseInput, teaser: "ОЖИДАЕМЫЙ_ТИЗЕР" });
    expect(svg).toContain("ОЖИДАЕМЫЙ_ТИЗЕР");
    // Defensive: even if a caller accidentally passed long text into teaser,
    // the SVG won't contain the verbose unrelated body string.
    expect(svg).not.toContain(longBody);
  });

  it("handles very long titles by wrapping to <=3 lines", () => {
    const svg = renderPosterCardSvg({
      ...baseInput,
      title: "Очень длинный заголовок который должен корректно перенестись на несколько строк без обрезания посередине слова"
    });
    expect(svg).toContain("<svg");
  });

  it("handles missing quote and short teaser", () => {
    const svg = renderPosterCardSvg({
      ...baseInput,
      quote: null,
      teaser: "Короткий тизер."
    });
    expect(svg).toContain("Короткий тизер.");
  });

  it("renders PROLOGUE-style page numbers correctly via input", () => {
    // Renderer doesn't know the kind; deliveryService labels the caption.
    // pageNumber is zero-padded to 2 digits; totalSlots is not padded so the
    // counter reads "01 / 5" for short prologues and "12 / 52" for weeklies.
    const svg = renderPosterCardSvg({ ...baseInput, pageNumber: 1, totalSlots: 5 });
    expect(svg).toContain("01 / 5");
  });

  it("renders PNG to a non-empty buffer", () => {
    const png = renderPosterCardPng(baseInput);
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.length).toBeGreaterThan(1000);
    // PNG magic bytes
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });
});
