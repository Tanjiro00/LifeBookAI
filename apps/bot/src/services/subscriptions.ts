import type { User } from "@prisma/client";
import { config } from "../config.js";
import { getSavedChapterCount } from "./userService.js";

export async function canCreateAnotherChapter(user: User): Promise<boolean> {
  if (user.isPaid) {
    return true;
  }

  const savedChapters = await getSavedChapterCount(user.id);
  return savedChapters < config.FREE_CHAPTER_LIMIT;
}

export function freeLimitText(): string {
  return [
    "В бесплатной версии можно сохранить 3 главы.",
    "",
    "Pro откроет безлимитные главы, голосовые, память, карточки и PDF-экспорт. В MVP платежи уже заложены, но можно включить их позже через Telegram Stars."
  ].join("\n");
}

