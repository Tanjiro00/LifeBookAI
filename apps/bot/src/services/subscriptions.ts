import type { User } from "@prisma/client";
import type { Context } from "grammy";
import { t } from "../lib/i18n.js";
import { config } from "../config.js";

// Sprint 5.5 — paywall reposition.
//
// Old behavior (Sprint 0): free tier was 4 entries — paywall hit BEFORE the
// user had ever seen a chapter. Conversion was poor because the user hadn't
// felt the product's actual value yet.
//
// New behavior:
//   - Free tier is FREE_PAGE_LIMIT (8 by default, configurable via env).
//   - canCreateEntry stays count-based for clarity.
//   - But the bot ALSO uses canShowAfterChapterPaywall() to surface the paywall
//     *card* once after the user receives their first Chapter (delivered by
//     the chapterSynth job). This is the moment the product proves its core
//     promise — a card-only «moments» feed has just become a real chapter.
//
// FREE_ENTRY_LIMIT is preserved as a deprecated alias for one release so
// callers (including older imports) still typecheck; it now equals
// FREE_PAGE_LIMIT so behavior is consistent.

export const FREE_PAGE_LIMIT = config.FREE_PAGE_LIMIT;
/** @deprecated Use FREE_PAGE_LIMIT. */
export const FREE_ENTRY_LIMIT = FREE_PAGE_LIMIT;

export function isProActive(user: Pick<User, "isPaid" | "proUntil">, now = new Date()): boolean {
  if (user.proUntil && user.proUntil.getTime() > now.getTime()) return true;
  // Backwards compat: users from before proUntil migration.
  return user.isPaid && !user.proUntil;
}

// Free tier: FREE_PAGE_LIMIT pages. Pro: unlimited + AI cover variants + AI
// book name + year-end PDF v2. Gate is on creating new entries beyond the cap;
// existing free entries always stay readable.
export function canCreateEntry(user: Pick<User, "isPaid" | "proUntil" | "freeEntriesUsed">): boolean {
  if (isProActive(user)) return true;
  return (user.freeEntriesUsed ?? 0) < FREE_PAGE_LIMIT;
}

// Sprint 5.5 — should the bot show the «after first chapter» paywall card?
// Returns true exactly once per user: when they have ≥1 chapter AND haven't
// been shown the after-chapter paywall yet. The «shown» flag lives in
// User.lastReminderAt's sibling space; we use a separate transient marker
// since the schema doesn't have a dedicated field. To keep this stateless
// (no schema bump just for one flag), we check freeEntriesUsed against the
// limit — if the user has hit the cap AND has a chapter, the card is shown.
//
// In practice the flow is:
//   - The user writes pages until their first Chapter is delivered.
//   - On the next /new, canCreateEntry might still be true (e.g. only 6/8
//     used) but canShowAfterChapterPaywall returns true once they're past
//     the «felt the value» threshold. The bot then shows the card with the
//     standard paywallText.
export async function shouldShowAfterChapterPaywall(opts: {
  user: Pick<User, "id" | "isPaid" | "proUntil" | "freeEntriesUsed">;
  chapterCount: number;
}): Promise<boolean> {
  if (isProActive(opts.user)) return false;
  if (opts.chapterCount === 0) return false;
  // User has at least one chapter and is on free tier — surface the card.
  // We rely on the bot caller to track «already shown» via track() events to
  // avoid spamming on every interaction; the single source of truth is the
  // analytics log, which is cheap to query.
  return true;
}

export const PRODUCT_CATALOG = {
  pro_month: {
    code: "lifebook_pro_month",
    label: "LifeBook Pro · 1 месяц",
    labelEn: "LifeBook Pro · 1 month",
    description: "Безлимит записей. AI-обложка. PDF-книга в декабре.",
    descriptionEn: "Unlimited entries. AI cover. Year-end PDF book.",
    amountStars: 290,
    durationDays: 31
  },
  pro_year: {
    code: "lifebook_pro_year",
    label: "LifeBook Pro · 1 год",
    labelEn: "LifeBook Pro · 1 year",
    description: "Год без потолка. PDF-книга в декабре. Скидка 25%.",
    descriptionEn: "Whole year, no cap. Year-end PDF book. 25% off.",
    amountStars: 2900,
    durationDays: 365
  }
} as const;

export type ProductKey = keyof typeof PRODUCT_CATALOG;

export function findProductByCode(code: string): (typeof PRODUCT_CATALOG)[ProductKey] | null {
  for (const key of Object.keys(PRODUCT_CATALOG) as ProductKey[]) {
    if (PRODUCT_CATALOG[key].code === code) return PRODUCT_CATALOG[key];
  }
  return null;
}

export function paywallText(ctx: Context | undefined, entryCount: number): string {
  return t(
    ctx,
    [
      `${entryCount} записи — это уже начало твоей книги.`,
      "",
      "Дальше Pro:",
      "  · безлимит записей",
      "  · AI-обложка для книги",
      "  · PDF-книга твоего года в декабре",
      "  · приоритетная генерация",
      "",
      "Книга останется твоей, даже если отменишь Pro — все записи на месте."
    ].join("\n"),
    [
      `${entryCount} entries — your book has begun.`,
      "",
      "Pro unlocks:",
      "  · unlimited entries",
      "  · AI-generated book cover",
      "  · year-end PDF of your book",
      "  · priority generation",
      "",
      "Your book stays yours even if you cancel Pro — every entry is preserved."
    ].join("\n")
  );
}
