import { describe, expect, it } from "vitest";
import { isoWeekLabel, pickWeekColor, WEEK_COLORS } from "../packages/renderer/src/palette.js";

describe("week color palette", () => {
  it("maps tired/heavy moods to charcoal", () => {
    expect(pickWeekColor({ mood: ["tired"] }).key).toBe("charcoal");
    expect(pickWeekColor({ mood: ["усталость"] }).key).toBe("charcoal");
  });

  it("maps warm/intimate moods to bronze", () => {
    expect(pickWeekColor({ mood: ["warm"] }).key).toBe("bronze");
    expect(pickWeekColor({ mood: ["intimate", "tired"] }).key).toBe("bronze");
  });

  it("maps turning-point tags to burgundy", () => {
    expect(pickWeekColor({ tags: ["change"] }).key).toBe("burgundy");
  });

  it("falls back deterministically when no mood matches", () => {
    const a = pickWeekColor({ mood: ["nothingmatches"], fallbackSeed: "weekA" });
    const b = pickWeekColor({ mood: ["nothingmatches"], fallbackSeed: "weekA" });
    expect(a.key).toBe(b.key);
    expect(Object.keys(WEEK_COLORS)).toContain(a.key);
  });

  it("computes ISO week labels with the W##/YYYY format", () => {
    expect(isoWeekLabel(new Date("2026-04-27T12:00:00Z"))).toMatch(/^W\d{2}\/2026$/);
    expect(isoWeekLabel(new Date("2026-01-04T12:00:00Z"))).toBe("W01/2026");
  });
});
