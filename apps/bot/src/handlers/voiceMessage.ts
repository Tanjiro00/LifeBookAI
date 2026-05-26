import type { Context } from "grammy";
import { UserState } from "@prisma/client";
import { transcribeAudio } from "@lifebook/ai";
import { handleVoiceMessage } from "../conversations/weeklyEntry.js";
import { handleIntakeAnswer } from "../conversations/onboarding.js";
import { ensureTelegramUser } from "../services/userService.js";
import { downloadTelegramFile } from "../services/telegramFiles.js";
import { logger } from "../lib/logger.js";
import { t } from "../lib/i18n.js";
import { replyWithFriendlyError } from "../lib/errors.js";

export async function handleVoiceMessageUpdate(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);

  // During biographical intake, voice messages are transcribed and routed as
  // intake answers — NOT as weekly-entry candidates.
  if (user.state === UserState.ONBOARDING_INTAKE) {
    const voice = ctx.message?.voice;
    if (!voice) return;
    if (ctx.chat) await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    await ctx.reply(t(ctx, "🎙 Слушаю…", "🎙 Listening…"));
    try {
      const downloaded = await downloadTelegramFile(ctx, voice.file_id);
      const transcript = await transcribeAudio(downloaded.filePath);
      await handleIntakeAnswer(ctx, transcript.transcript);
    } catch (err) {
      logger.warn({ err }, "voice transcription during intake failed");
      await replyWithFriendlyError(ctx, err);
    }
    return;
  }

  // Default: weekly-entry voice handling.
  await handleVoiceMessage(ctx);
}
