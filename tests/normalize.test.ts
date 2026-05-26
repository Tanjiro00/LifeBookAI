import { describe, expect, it } from "vitest";
import { namesMatch, normalize } from "../packages/ai/src/memory/normalize.js";

describe("memory normalize", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalize("  Бабушка   Нина  ")).toBe(normalize("бабушка нина"));
    expect(normalize("Бабушка Нина")).toContain("нина");
  });

  it("alias-maps мама forms", () => {
    expect(normalize("мама")).toBe(normalize("мамочка"));
    expect(normalize("мамуля")).toBe(normalize("мама"));
    expect(normalize("Мам")).toBe(normalize("мама"));
  });

  it("alias-maps бабушка forms", () => {
    expect(normalize("бабушка")).toBe(normalize("бабуля"));
    expect(normalize("Бабушка Нина")).toBe(normalize("Бабуля Нина"));
  });

  it("strips punctuation", () => {
    expect(normalize("«мама»!")).toBe(normalize("мама"));
    expect(normalize("Денис, мой брат.")).toBe(normalize("Денис мой брат"));
  });

  it("keeps proper names intact", () => {
    expect(normalize("Денис Петров")).toBe("денис петров");
    expect(normalize("New York")).toBe("new york");
  });

  it("namesMatch handles surface variation", () => {
    expect(namesMatch("Бабуля Нина", "бабушка нина")).toBe(true);
    expect(namesMatch("Денис", "Дима")).toBe(false);
  });

  it("returns empty for empty input", () => {
    expect(normalize("")).toBe("");
    expect(normalize("   ")).toBe("");
  });
});
