import type { Context } from "grammy";
import { handleVoiceMessage } from "../conversations/weeklyEntry.js";

export async function handleVoiceMessageUpdate(ctx: Context): Promise<void> {
  await handleVoiceMessage(ctx);
}
