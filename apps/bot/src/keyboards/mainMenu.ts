import { InlineKeyboard, Keyboard } from "grammy";
import type { Context } from "grammy";
import { t } from "../lib/i18n.js";

// Two buttons under the weekly reminder. Skip is honest ("nothing this week"),
// Hints rotates a few prompt-style questions to break writer's block.
type CtxLike = Context | { languageCode?: string | null } | undefined;
export function weeklyPromptKeyboard(ctx?: CtxLike): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, "Подсказки", "Hints"), "entry:prompts")
    .text(t(ctx, "Пропустить", "Skip"), "entry:skip");
}

// Persistent reply keyboard with the four most-used actions. Stays visible across
// messages so users always have a one-tap path to a new entry, the book, stats,
// and settings — without requiring slash commands.
export function mainMenuKeyboard(ctx?: Context): Keyboard {
  return new Keyboard()
    .text(t(ctx, "📝 Новая запись", "📝 New entry"))
    .text(t(ctx, "📖 Моя книга", "📖 My book"))
    .row()
    .text(t(ctx, "📊 Статистика", "📊 Stats"))
    .text(t(ctx, "⚙️ Настройки", "⚙️ Settings"))
    .resized()
    .persistent();
}

// Reverse-lookup: is the supplied text one of the persistent menu labels?
// Returns the canonical action name when matched. Robust to emoji presence/absence,
// variation selectors, and casing — different Telegram clients render these slightly
// differently and we don't want a 1-character mismatch to silently route the tap to
// the entry-creation flow.
export function matchMainMenuLabel(_ctx: Context, text: string): "new" | "book" | "stats" | "settings" | null {
  const normalized = text
    // strip every emoji + symbol + variation selector so we compare letter-only.
    .replace(/[\p{Emoji}\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const aliases: Record<string, "new" | "book" | "stats" | "settings"> = {
    "новая запись": "new",
    "new entry": "new",
    "моя книга": "book",
    "my book": "book",
    "статистика": "stats",
    "стата": "stats",
    "stats": "stats",
    "настройки": "settings",
    "settings": "settings"
  };
  return aliases[normalized] ?? null;
}
