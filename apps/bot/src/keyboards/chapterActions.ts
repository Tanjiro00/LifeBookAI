import { InlineKeyboard } from "grammy";
import { isTelegramInlineUrl } from "../services/urls.js";

export const ADJUSTMENT_BY_CODE = {
  ld: "less_dramatic",
  sh: "shorter",
  lit: "more_literary",
  voice: "more_like_me",
  rg: "regenerate"
} as const;

export type AdjustmentCode = keyof typeof ADJUSTMENT_BY_CODE;

export function questionsKeyboard(entryId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Пропустить вопросы", `q:skip:${entryId}`)
    .text("Сгенерировать главу", `q:gen:${entryId}`);
}

export function voiceTranscriptKeyboard(entryId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Да, продолжить", `voice:go:${entryId}`)
    .text("Я добавлю ещё", `voice:add:${entryId}`)
    .row()
    .text("Отменить", `voice:cancel:${entryId}`);
}

export function chapterActionsKeyboard(chapterId: string, previewUrl: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("Сохранить", `ch:save:${chapterId}`)
    .text("Сделать менее пафосно", `ch:adj:ld:${chapterId}`)
    .row()
    .text("Сделать короче", `ch:adj:sh:${chapterId}`)
    .text("Более литературно", `ch:adj:lit:${chapterId}`)
    .row()
    .text("Больше похоже на меня", `ch:adj:voice:${chapterId}`)
    .text("Переделать", `ch:adj:rg:${chapterId}`)
    .row();

  if (isTelegramInlineUrl(previewUrl)) {
    return keyboard.url("Открыть как страницу книги", previewUrl);
  }

  return keyboard.text("Открыть как страницу книги", `preview:chapter:${chapterId}`);
}

export function savedChapterKeyboard(chapterId: string, previewUrl: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("Моя книга", "menu:book")
    .text("Написать ещё одну главу", "menu:new")
    .row();

  if (isTelegramInlineUrl(previewUrl)) {
    return keyboard.url("Поделиться главой", previewUrl);
  }

  return keyboard.text("Открыть локальную ссылку", `preview:chapter:${chapterId}`);
}
