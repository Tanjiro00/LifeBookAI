import { InlineKeyboard } from "grammy";

// Two buttons under the weekly reminder. Skip is honest ("nothing this week"),
// Hints rotates 4 prompt-style questions to break writer's block.
export function weeklyPromptKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Подсказки", "entry:prompts")
    .text("Пропустить", "entry:skip");
}
