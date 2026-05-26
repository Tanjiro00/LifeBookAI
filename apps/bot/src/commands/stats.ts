import type { Context } from "grammy";
import { ensureTelegramUser } from "../services/userService.js";
import { formatStatsText, getStatsForUser } from "../services/statsService.js";
import { isEnglish } from "../lib/i18n.js";
import { track } from "../services/analytics.js";

export async function sendStats(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  track("stats_opened", { userId: user.id });
  const stats = await getStatsForUser(user.id);
  const language = isEnglish(ctx) ? "en" : "ru";
  await ctx.reply(formatStatsText(stats, language));
}
