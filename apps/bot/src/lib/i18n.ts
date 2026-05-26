import type { Context } from "grammy";

// Lightweight bilingual helper. Russian is the product's primary language; English
// is offered when Telegram reports an `en*` locale on the user's profile.
export function isEnglish(ctx: Pick<Context, "from"> | { languageCode?: string | null } | null | undefined): boolean {
  if (!ctx) return false;
  const code =
    "from" in ctx ? ctx.from?.language_code : (ctx as { languageCode?: string | null }).languageCode;
  return Boolean(code?.toLowerCase().startsWith("en"));
}

export function t(
  ctx: Pick<Context, "from"> | { languageCode?: string | null } | null | undefined,
  ru: string,
  en: string
): string {
  return isEnglish(ctx) ? en : ru;
}
