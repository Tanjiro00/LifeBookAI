import { Bot, GrammyError, HttpError } from "grammy";
import { EntryStatus, UserState } from "@prisma/client";
import { config } from "./config.js";
import { sendBook } from "./commands/book.js";
import { sendHelp } from "./commands/help.js";
import { sendNewChapterPrompt } from "./commands/new.js";
import { sendPaySupport } from "./commands/paysupport.js";
import { sendPrivacy } from "./commands/privacy.js";
import { sendSettings } from "./commands/settings.js";
import { sendStart } from "./commands/start.js";
import { handleCallbackQuery } from "./handlers/callbackQuery.js";
import { handleSuccessfulPayment, handlePreCheckoutQuery } from "./handlers/payment.js";
import { handleTextMessage } from "./handlers/textMessage.js";
import { handleVoiceMessageUpdate } from "./handlers/voiceMessage.js";
import { ensureTelegramUser } from "./services/userService.js";
import { deleteLatestPage } from "./services/chapterService.js";
import { prisma } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import { rateLimit } from "./lib/rateLimit.js";

export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  bot.use(rateLimit({ limit: 24, windowMs: 60_000 }));

  bot.command("start", sendStart);
  bot.command("new", sendNewChapterPrompt);
  bot.command("book", sendBook);
  bot.command("settings", sendSettings);
  bot.command("help", sendHelp);
  bot.command("privacy", sendPrivacy);
  bot.command("paysupport", sendPaySupport);

  bot.command("delete_last", async (ctx) => {
    const user = await ensureTelegramUser(ctx);
    const deleted = await deleteLatestPage(user.id);
    await ctx.reply(deleted ? `Удалил запись «${deleted.sceneTitle}».` : "Записей пока нет.");
  });

  bot.command("cancel", async (ctx) => {
    const user = await ensureTelegramUser(ctx);
    // Archive any in-flight raw entries so they don't dangle.
    await prisma.entry.updateMany({
      where: {
        userId: user.id,
        status: { in: [EntryStatus.DRAFT, EntryStatus.COLLECTED, EntryStatus.QUESTIONS_GENERATED, EntryStatus.ANSWERS_COLLECTED] }
      },
      data: { status: EntryStatus.ARCHIVED }
    });
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    await ctx.reply("Остановил. /new — начать новую запись.");
  });

  bot.callbackQuery(/.*/, handleCallbackQuery);
  bot.on("pre_checkout_query", handlePreCheckoutQuery);
  bot.on("message:successful_payment", handleSuccessfulPayment);
  bot.on("message:voice", handleVoiceMessageUpdate);
  bot.on("message:text", handleTextMessage);

  bot.catch((error) => {
    const ctx = error.ctx;
    const err = error.error;
    if (err instanceof GrammyError) {
      logger.error({ err: { message: err.message, code: err.error_code }, updateId: ctx.update.update_id }, "Telegram API error");
      return;
    }
    if (err instanceof HttpError) {
      logger.error({ err: { message: err.message }, updateId: ctx.update.update_id }, "Telegram network error");
      return;
    }
    logger.error({ err: { message: (err as Error).message }, updateId: ctx.update.update_id }, "Unexpected bot error");
  });

  return bot;
}

export async function setBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start",       description: "начать книгу твоего года" },
    { command: "new",         description: "записать момент" },
    { command: "book",        description: "моя книга" },
    { command: "settings",    description: "напоминания и план" },
    { command: "help",        description: "как это работает" },
    { command: "privacy",     description: "приватность" },
    { command: "paysupport",  description: "поддержка по платежам" },
    { command: "delete_last", description: "удалить последнюю запись" },
    { command: "cancel",      description: "выйти из текущего сценария" }
  ]);
}
