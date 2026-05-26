import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { t } from "../lib/i18n.js";

export function confirmDeleteKeyboard(ctx?: Context): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, "Да, удалить", "Yes, delete"), "delete:last:yes")
    .text(t(ctx, "Отмена", "Cancel"), "delete:last:no");
}

// Used at the entry-5 paywall and on /book for free users.
export function paywallKeyboard(ctx?: Context): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(ctx, "Pro · 2900 ⭐ за год", "Pro · 2900 ⭐ / year"), "pay:year")
    .row()
    .text(t(ctx, "Pro · 290 ⭐ за месяц", "Pro · 290 ⭐ / month"), "pay:month")
    .row()
    .text(t(ctx, "Открыть мою книгу", "Open my book"), "menu:book");
}

// One inline keyboard with four focused actions surfaced in /settings. Each opens a
// dedicated flow instead of cramming everything into one screen.
export function settingsActionsKeyboard(ctx: Context, isPro: boolean, followupEnabled: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t(ctx, "📚 Название", "📚 Title"), "set:title")
    .text(t(ctx, "🔔 Напоминания", "🔔 Reminders"), "set:reminders")
    .row();

  if (followupEnabled) {
    kb.text(t(ctx, "❌ Отключить вопросы", "❌ Disable questions"), "set:followup:off");
  } else {
    kb.text(t(ctx, "✅ Включить вопросы", "✅ Enable questions"), "set:followup:on");
  }

  if (isPro) {
    kb.text(t(ctx, "💎 Pro активен", "💎 Pro active"), "set:plan");
  } else {
    kb.text(t(ctx, "💎 Pro · 2900 ⭐", "💎 Pro · 2900 ⭐"), "set:plan");
  }

  return kb;
}
