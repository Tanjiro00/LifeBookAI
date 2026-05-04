import { InlineKeyboard } from "grammy";

export const GOAL_LABELS: Record<string, string> = {
  self: "Для себя",
  children: "Для будущих детей",
  family: "Для семьи",
  year: "Про этот год",
  new_life: "Про переезд / новую жизнь",
  career: "Про карьеру / стартап"
};

export const STYLE_LABELS: Record<string, string> = {
  simple: "Честно и просто",
  literary: "Литературно",
  cinematic: "Кинематографично",
  warm: "Тепло и глубоко",
  funny: "С юмором",
  novel: "Как роман"
};

export const DAY_LABELS: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс"
};

export function goalKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(GOAL_LABELS.self!, "onb:goal:self")
    .text(GOAL_LABELS.children!, "onb:goal:children")
    .row()
    .text(GOAL_LABELS.family!, "onb:goal:family")
    .text(GOAL_LABELS.year!, "onb:goal:year")
    .row()
    .text(GOAL_LABELS.new_life!, "onb:goal:new_life")
    .row()
    .text(GOAL_LABELS.career!, "onb:goal:career");
}

export function styleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(STYLE_LABELS.simple!, "onb:style:simple")
    .text(STYLE_LABELS.literary!, "onb:style:literary")
    .row()
    .text(STYLE_LABELS.cinematic!, "onb:style:cinematic")
    .text(STYLE_LABELS.warm!, "onb:style:warm")
    .row()
    .text(STYLE_LABELS.funny!, "onb:style:funny")
    .text(STYLE_LABELS.novel!, "onb:style:novel");
}

export function frequencyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Раз в неделю", "onb:freq:WEEKLY")
    .text("Раз в месяц", "onb:freq:MONTHLY")
    .row()
    .text("Без напоминаний", "onb:freq:MANUAL");
}

export function dayKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Пн", "onb:day:1")
    .text("Вт", "onb:day:2")
    .text("Ср", "onb:day:3")
    .text("Чт", "onb:day:4")
    .row()
    .text("Пт", "onb:day:5")
    .text("Сб", "onb:day:6")
    .text("Вс", "onb:day:7");
}

export function timeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("09:00", "onb:time:09:00")
    .text("12:00", "onb:time:12:00")
    .row()
    .text("18:00", "onb:time:18:00")
    .text("21:00", "onb:time:21:00")
    .row()
    .text("Выбрать своё", "onb:time:custom");
}

export function privacyKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Понятно, начать первую главу", "onb:privacy_ok");
}
