import type { Context } from "grammy";
import { promptForNewEntry } from "../conversations/weeklyEntry.js";
import { ensureTelegramUser } from "../services/userService.js";
import { track } from "../services/analytics.js";

export async function sendNewChapterPrompt(ctx: Context): Promise<void> {
  if (ctx.from) {
    const user = await ensureTelegramUser(ctx);
    track("entry_started", { userId: user.id });
  }
  await promptForNewEntry(ctx);
}
