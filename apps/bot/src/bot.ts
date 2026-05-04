import { Bot, GrammyError, HttpError } from "grammy";
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
import { deleteLatestSavedChapter } from "./services/chapterService.js";
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
  bot.command("remind", sendSettings);
  bot.command("style", async (ctx) => {
    await ctx.reply("Открой настройки и выбери новый стиль книги.");
    await sendSettings(ctx);
  });
  bot.command("export", async (ctx) => {
    await ctx.reply("Экспорт PDF подготовлен как следующий шаг. Сейчас можно открывать главы как красивые страницы книги.");
  });
  bot.command("delete_last", async (ctx) => {
    const user = await ensureTelegramUser(ctx);
    const deleted = await deleteLatestSavedChapter(user.id);
    await ctx.reply(deleted ? `Удалил последнюю главу: “${deleted.title}”.` : "Сохранённых глав пока нет.");
  });
  bot.command("cancel", async (ctx) => {
    const user = await ensureTelegramUser(ctx);
    await prisma.user.update({ where: { id: user.id }, data: { state: "READY" } });
    await ctx.reply("Остановил текущий сценарий. Можно начать новую главу через /new.");
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
      logger.error({ err, updateId: ctx.update.update_id }, "Telegram API error");
      return;
    }

    if (err instanceof HttpError) {
      logger.error({ err, updateId: ctx.update.update_id }, "Telegram network error");
      return;
    }

    logger.error({ err, updateId: ctx.update.update_id }, "Unexpected bot error");
  });

  return bot;
}

export async function setBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "начать или открыть главное меню" },
    { command: "new", description: "написать новую главу" },
    { command: "book", description: "моя книга" },
    { command: "settings", description: "настройки" },
    { command: "help", description: "помощь" },
    { command: "privacy", description: "приватность" },
    { command: "paysupport", description: "поддержка по платежам" },
    { command: "export", description: "экспорт книги" },
    { command: "delete_last", description: "удалить последнюю главу" },
    { command: "remind", description: "изменить напоминания" },
    { command: "style", description: "изменить стиль письма" }
  ]);
}

