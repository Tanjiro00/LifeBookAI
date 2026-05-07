import type { User } from "@prisma/client";

export const FREE_ENTRY_LIMIT = 4;

export function isProActive(user: Pick<User, "isPaid" | "proUntil">, now = new Date()): boolean {
  if (user.proUntil && user.proUntil.getTime() > now.getTime()) return true;
  // Backwards compat: users from before proUntil migration.
  return user.isPaid && !user.proUntil;
}

// Free tier: 4 entries. Pro: unlimited + AI cover + AI book name + year-end PDF.
// Gate is on creating new entries beyond the cap; existing free entries always stay readable.
export function canCreateEntry(user: Pick<User, "isPaid" | "proUntil" | "freeEntriesUsed">): boolean {
  if (isProActive(user)) return true;
  return (user.freeEntriesUsed ?? 0) < FREE_ENTRY_LIMIT;
}

export const PRODUCT_CATALOG = {
  pro_month: {
    code: "lifebook_pro_month",
    label: "LifeBook Pro · 1 месяц",
    description: "Безлимит записей. AI-обложка. PDF-книга в декабре.",
    amountStars: 290,
    durationDays: 31
  },
  pro_year: {
    code: "lifebook_pro_year",
    label: "LifeBook Pro · 1 год",
    description: "Год без потолка. PDF-книга в декабре. Скидка 25%.",
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

export function paywallText(entryCount: number): string {
  return [
    `${entryCount} записи — это уже начало твоей книги.`,
    "",
    "Дальше — Pro: безлимит записей, AI-обложка для книги, и в декабре получаешь PDF-книгу твоего года."
  ].join("\n");
}
