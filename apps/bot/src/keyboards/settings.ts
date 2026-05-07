import { InlineKeyboard } from "grammy";

export function confirmDeleteKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Да, удалить", "delete:last:yes")
    .text("Отмена", "delete:last:no");
}

// Used at the entry-5 paywall and on /book for free users.
// Two pricing options: month (290 ⭐) and year (2900 ⭐), with the year as the recommended anchor.
export function paywallKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Pro · 2900 ⭐ за год", "pay:year")
    .row()
    .text("Pro · 290 ⭐ за месяц", "pay:month")
    .row()
    .text("Открыть мою книгу", "menu:book");
}
