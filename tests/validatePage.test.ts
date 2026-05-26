import { describe, expect, it } from "vitest";
import { validatePage } from "../packages/ai/src/generation/validatePage.js";
import type { EntryPlan } from "../packages/ai/src/generation/planEntry.js";
import type { EntryOutput } from "../packages/ai/src/schemas.js";

// Sprint 2.3 — validator unit tests. Pure function, no I/O, easy to drive.

const PLAN: EntryPlan = {
  pageRole: "continues_thread",
  centralScene: "User describes a quiet morning making coffee.",
  factualBoundaries: [],
  continuityMoves: [],
  threadsToUpdate: [],
  memoriesToCreateOrMerge: [],
  styleNotes: [],
  riskFlags: []
};

function makeOutput(overrides: Partial<EntryOutput> = {}): EntryOutput {
  // Body sits in the 200-360 word band the writer prompt aims for. Three
  // paragraphs, varied rhythm, no SaaS clichés, no continuity tokens — so the
  // baseline output passes validation cleanly.
  const paragraph =
    "Я проснулся раньше будильника. На кухне было прохладно, и пар от кофе шёл медленно, будто тоже не торопился. " +
    "Я сидел у окна и смотрел, как снег лежал на крышах домов через дорогу. Звуки города были приглушённые, " +
    "будто кто-то накрыл их толстым покрывалом. Я не пытался ничего успеть, не открывал телефон, не думал о " +
    "сегодняшнем расписании. Просто пил первую чашку и слушал, как зима ходит по карнизу. Минут через пятнадцать " +
    "я налил вторую чашку, она остыла быстрее, и от этого кофе стал немного крепче на вкус. ";
  const base: EntryOutput = {
    title: "Тихое утро",
    body: [paragraph.trim(), paragraph.trim(), paragraph.trim()].join("\n\n"),
    quote: "Я не пытался ничего успеть.",
    teaser: "Я проснулся раньше будильника. На кухне было прохладно, и пар от кофе шёл медленно.",
    pageSummary: "Quiet morning page about an unhurried coffee in winter, no phone.",
    mood: ["quiet"],
    tags: ["утро", "кофе"],
    memoryUpdates: []
  };
  return { ...base, ...overrides };
}

describe("validatePage", () => {
  it("passes a well-formed page", () => {
    const v = validatePage({ output: makeOutput(), plan: PLAN });
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.repairInstruction).toBeNull();
    expect(v.stats.paragraphCount).toBe(3);
  });

  it("flags too-short body", () => {
    const v = validatePage({
      output: makeOutput({
        body: "Слишком коротко. Меньше ста шестидесяти слов."
      }),
      plan: PLAN
    });
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("too_short");
  });

  it("flags too-long body for non-turning_point", () => {
    const longBody =
      "Слово ".repeat(500); // ~500 words — exceeds 400 max for non-turning
    const v = validatePage({ output: makeOutput({ body: longBody }), plan: PLAN });
    expect(v.errors).toContain("too_long");
  });

  it("allows longer body when plan.pageRole=turning_point", () => {
    const longBody =
      "Слово ".repeat(420); // ~420 words — within 480 turning-point max
    const v = validatePage({
      output: makeOutput({ body: longBody }),
      plan: { ...PLAN, pageRole: "turning_point" }
    });
    expect(v.errors).not.toContain("too_long");
  });

  it("flags missing paragraphs", () => {
    const flat =
      "Слово ".repeat(200);
    const v = validatePage({ output: makeOutput({ body: flat.trim() }), plan: PLAN });
    expect(v.errors).toContain("no_paragraphs");
  });

  it("flags generic SaaS reflection", () => {
    const generic = makeOutput({
      body:
        [
          "Это была настоящая трансформация. Я наконец почувствовал, что иду правильным путём.",
          "Каждый день был частью моего путешествия к себе. Healing шло своим чередом.",
          "Я знал, что амазинг джорни только начинается. Step into your power, говорил я себе."
        ].join("\n\n")
    });
    const v = validatePage({ output: generic, plan: PLAN });
    expect(v.errors).toContain("generic_reflection");
    expect(v.repairInstruction).toMatch(/SaaS|self-help/i);
  });

  it("flags missing continuity when plan asked for it", () => {
    const planWithMove: EntryPlan = {
      ...PLAN,
      continuityMoves: [
        {
          move: "Echo the specific word 'альбом' from the April page about мама.",
          mustBeSubtle: true
        }
      ]
    };
    const v = validatePage({ output: makeOutput(), plan: planWithMove });
    expect(v.errors).toContain("missing_continuity_when_plan_required_it");
  });

  it("accepts continuity when the body contains the requested token", () => {
    const planWithMove: EntryPlan = {
      ...PLAN,
      continuityMoves: [
        {
          move: "Reference the старый альбом from the previous page.",
          mustBeSubtle: true
        }
      ]
    };
    const output = makeOutput({
      body: [
        "Я листал альбом, и каждая фотография была как короткий разговор.",
        "Под кофе пахло корицей. Снаружи звуки города звучали приглушённо.",
        "Через час я закрыл альбом и поставил его на полку — туда же, где он стоял раньше."
      ].join("\n\n")
    });
    const v = validatePage({ output, plan: planWithMove });
    expect(v.errors).not.toContain("missing_continuity_when_plan_required_it");
  });

  it("flags teaser too short", () => {
    const v = validatePage({
      output: makeOutput({ teaser: "Кратко." }),
      plan: PLAN
    });
    expect(v.errors).toContain("teaser_too_short");
  });

  it("flags teaser too long", () => {
    const v = validatePage({
      output: makeOutput({ teaser: "Очень-очень-очень длинный teaser ".repeat(20) }),
      plan: PLAN
    });
    expect(v.errors).toContain("teaser_too_long");
  });
});
