import { InlineKeyboard } from "grammy";

export function startKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Начать мою книгу", "start:onboarding")
    .row()
    .text("Посмотреть пример", "start:example")
    .text("Как это работает", "start:how");
}

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Новая глава", "menu:new")
    .text("Моя книга", "menu:book")
    .row()
    .text("Настройки", "menu:settings")
    .text("Экспорт", "menu:export");
}

export function weeklyPromptKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Подсказки", "entry:prompts")
    .text("Пропустить неделю", "entry:skip")
    .row()
    .text("Настройки", "menu:settings");
}

export function backToStartKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Хочу так же", "start:onboarding").text("Назад", "nav:start");
}

