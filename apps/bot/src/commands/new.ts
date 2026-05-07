import type { Context } from "grammy";
import { promptForNewEntry } from "../conversations/weeklyEntry.js";
import { track } from "../services/analytics.js";

export async function sendNewChapterPrompt(ctx: Context): Promise<void> {
  if (ctx.from) track("entry_started", { userId: String(ctx.from.id) });
  await promptForNewEntry(ctx);
}
