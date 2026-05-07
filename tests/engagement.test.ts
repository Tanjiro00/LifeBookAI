import { describe, expect, it } from "vitest";
import { pickReminderText, shouldSendCatchup } from "../apps/bot/src/services/engagement.js";
import { splitForTelegram } from "../apps/bot/src/lib/messageSplit.js";
import { canCreateEntry, FREE_ENTRY_LIMIT } from "../apps/bot/src/services/subscriptions.js";

describe("reminder text rotation", () => {
  it("varies copy by week index", () => {
    const a = pickReminderText({ language: "ru", weekIndex: 0 });
    const b = pickReminderText({ language: "ru", weekIndex: 1 });
    expect(a).not.toEqual(b);
  });
  it("references previous title when given", () => {
    const text = pickReminderText({ language: "ru", weekIndex: 0, lastTitle: "Тихий понедельник" });
    expect(text).toContain("Тихий понедельник");
  });
});

describe("catchup eligibility", () => {
  it("fires only at 14-16 days", () => {
    expect(shouldSendCatchup({ daysSinceLastEntry: 14, lastCatchupAt: null })).toBe(true);
    expect(shouldSendCatchup({ daysSinceLastEntry: 13, lastCatchupAt: null })).toBe(false);
    expect(shouldSendCatchup({ daysSinceLastEntry: 30, lastCatchupAt: null })).toBe(false);
  });
});

describe("Telegram message split", () => {
  it("respects the limit", () => {
    const para = "Lorem ipsum. ".repeat(60);
    const text = `${para}\n\n${para}`;
    const chunks = splitForTelegram(text, 600);
    expect(chunks.every((c) => c.length <= 600)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("free-tier paywall", () => {
  it("allows up to FREE_ENTRY_LIMIT free entries", () => {
    expect(canCreateEntry({ isPaid: false, proUntil: null, freeEntriesUsed: 0 })).toBe(true);
    expect(canCreateEntry({ isPaid: false, proUntil: null, freeEntriesUsed: FREE_ENTRY_LIMIT - 1 })).toBe(true);
    expect(canCreateEntry({ isPaid: false, proUntil: null, freeEntriesUsed: FREE_ENTRY_LIMIT })).toBe(false);
  });
  it("Pro users bypass the cap", () => {
    const future = new Date(Date.now() + 86400_000);
    expect(canCreateEntry({ isPaid: false, proUntil: future, freeEntriesUsed: 100 })).toBe(true);
  });
});
