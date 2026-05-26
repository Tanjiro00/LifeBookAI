import { Bot, GrammyError, HttpError } from "grammy";
import { sequentialize } from "@grammyjs/runner";
import { autoRetry } from "@grammyjs/auto-retry";
import { EntryStatus, UserState } from "@prisma/client";
import { config } from "./config.js";
import { sendBook } from "./commands/book.js";
import { sendHelp } from "./commands/help.js";
import { sendNewChapterPrompt } from "./commands/new.js";
import { sendPaySupport } from "./commands/paysupport.js";
import {
  sendPrivacy,
  sendDataExport,
  sendDeleteAccountPrompt,
  undoDeleteAccount
} from "./commands/privacy.js";
import { sendSettings } from "./commands/settings.js";
import { sendStart } from "./commands/start.js";
import { sendStats } from "./commands/stats.js";
import { sendMemories } from "./commands/memories.js";
import { sendExport } from "./commands/export.js";
import { sendTitlePrompt } from "./commands/title.js";
import { handleCallbackQuery } from "./handlers/callbackQuery.js";
import { handleSuccessfulPayment, handlePreCheckoutQuery } from "./handlers/payment.js";
import { handleTextMessage } from "./handlers/textMessage.js";
import { handleVoiceMessageUpdate } from "./handlers/voiceMessage.js";
import { ensureTelegramUser } from "./services/userService.js";
import { deleteLatestPage } from "./services/chapterService.js";
import { prisma } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import { rateLimit } from "./lib/rateLimit.js";
import { t } from "./lib/i18n.js";

export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // Production grammY plugins:
  //  - auto-retry: handle Telegram flood-wait (429) with built-in backoff.
  //  - sequentialize: serialize updates per-user so two messages can't race.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 5 }));
  bot.use(sequentialize((ctx) => ctx.from?.id?.toString()));

  bot.use(rateLimit({ limit: 24, windowMs: 60_000 }));

  bot.command("start", sendStart);
  bot.command("new", sendNewChapterPrompt);
  bot.command("book", sendBook);
  bot.command("settings", sendSettings);
  bot.command("stats", sendStats);
  bot.command("memories", sendMemories);
  bot.command("export", sendExport);
  bot.command("title", sendTitlePrompt);
  bot.command("help", sendHelp);
  bot.command("privacy", sendPrivacy);
  bot.command("paysupport", sendPaySupport);
  // Sprint 5.7 — GDPR right-to-portability + soft-delete with grace period.
  bot.command("export_data", sendDataExport);
  bot.command("delete_account", sendDeleteAccountPrompt);
  bot.command("undo_delete", undoDeleteAccount);

  bot.command("delete_last", async (ctx) => {
    const user = await ensureTelegramUser(ctx);
    const deleted = await deleteLatestPage(user.id);
    await ctx.reply(
      deleted
        ? t(ctx, `Удалил запись «${deleted.sceneTitle}».`, `Deleted entry "${deleted.sceneTitle}".`)
        : t(ctx, "Записей пока нет.", "No entries yet.")
    );
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
    await ctx.reply(t(ctx, "Остановил. /new — начать новую запись.", "Stopped. /new to start a new entry."));
  });

  bot.callbackQuery(/.*/, handleCallbackQuery);
  bot.on("pre_checkout_query", handlePreCheckoutQuery);
  bot.on("message:successful_payment", handleSuccessfulPayment);
  bot.on("message:voice", handleVoiceMessageUpdate);
  bot.on("message:text", handleTextMessage);

  // Catch-all for messages we don't handle (photos, stickers, documents, video, etc.).
  // Without this branch the bot would silently drop the update and the user wouldn't
  // know whether their message reached us.
  bot.on("message", async (ctx) => {
    if (ctx.message.text || ctx.message.voice) return;
    await ctx.reply(
      t(
        ctx,
        "Я работаю с текстом и голосовыми. Пришли пару строк или удерживай микрофон.",
        "I work with text or voice messages. Send a few lines or hold the mic."
      )
    );
  });

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
  // Russian command list (default for ru-* locales)
  await bot.api.setMyCommands(
    [
      { command: "start",       description: "начать книгу твоего года" },
      { command: "new",         description: "записать момент" },
      { command: "book",        description: "моя книга" },
      { command: "stats",       description: "статистика года" },
      { command: "memories",    description: "что я помню о тебе" },
      { command: "title",       description: "переименовать книгу" },
      { command: "export",      description: "скачать книгу в PDF (Pro)" },
      { command: "settings",    description: "напоминания и план" },
      { command: "help",        description: "как это работает" },
      { command: "privacy",     description: "приватность" },
      { command: "paysupport",  description: "поддержка по платежам" },
      { command: "delete_last", description: "удалить последнюю запись" },
      { command: "cancel",      description: "выйти из текущего сценария" }
    ],
    { language_code: "ru" }
  );

  // English command list
  await bot.api.setMyCommands(
    [
      { command: "start",       description: "begin your year's book" },
      { command: "new",         description: "capture a moment" },
      { command: "book",        description: "open my book" },
      { command: "stats",       description: "year stats" },
      { command: "memories",    description: "what I remember about you" },
      { command: "title",       description: "rename my book" },
      { command: "export",      description: "download my book PDF (Pro)" },
      { command: "settings",    description: "reminders and plan" },
      { command: "help",        description: "how it works" },
      { command: "privacy",     description: "privacy" },
      { command: "paysupport",  description: "payment support" },
      { command: "delete_last", description: "delete last entry" },
      { command: "cancel",      description: "exit current flow" }
    ],
    { language_code: "en" }
  );

  // Default command list (mirrors Russian for unknown locales).
  await bot.api.setMyCommands([
    { command: "start",       description: "начать / begin" },
    { command: "new",         description: "записать момент / new entry" },
    { command: "book",        description: "моя книга / my book" },
    { command: "stats",       description: "статистика / stats" },
    { command: "memories",    description: "память / memories" },
    { command: "title",       description: "название книги / rename book" },
    { command: "export",      description: "PDF (Pro)" },
    { command: "settings",    description: "настройки / settings" },
    { command: "help",        description: "помощь / help" },
    { command: "privacy",     description: "приватность / privacy" },
    { command: "paysupport",  description: "поддержка / support" },
    { command: "delete_last", description: "удалить последнюю / delete last" },
    { command: "cancel",      description: "отмена / cancel" }
  ]);

  // Set the persistent left-of-input menu button to open the command list.
  try {
    await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
  } catch (err) {
    logger.warn({ err }, "Failed to set chat menu button (non-fatal)");
  }
}
