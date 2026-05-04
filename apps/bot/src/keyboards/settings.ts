import { InlineKeyboard } from "grammy";

export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Стиль письма", "set:style")
    .text("Напоминания", "set:reminders")
    .row()
    .text("Приватность", "set:privacy")
    .text("Удалить последнюю главу", "set:delete_last")
    .row()
    .text("Главное меню", "nav:start");
}

export function confirmDeleteKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Да, удалить", "delete:last:yes")
    .text("Отмена", "delete:last:no");
}

export function paywallKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Unlock Pro", "pay:unlock")
    .row()
    .text("Моя книга", "menu:book");
}

