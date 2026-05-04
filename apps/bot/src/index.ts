import { run } from "@grammyjs/runner";
import { createBot, setBotCommands } from "./bot.js";
import { config } from "./config.js";
import { createServer } from "./server.js";
import { prisma } from "./lib/db.js";
import { closeRedis } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
import { ensureStorageDirs } from "./services/storage.js";
import { startReminderLoop } from "./services/reminders.js";

async function main(): Promise<void> {
  await ensureStorageDirs();
  await prisma.$connect();

  const bot = createBot();
  await setBotCommands(bot);

  const server = createServer(bot);
  await server.listen({ port: config.PORT, host: "0.0.0.0" });

  let reminderTimer: NodeJS.Timeout | undefined;
  let runner: ReturnType<typeof run> | undefined;

  if (config.BOT_MODE === "webhook") {
    if (!config.BOT_WEBHOOK_URL) {
      throw new Error("BOT_WEBHOOK_URL is required in webhook mode.");
    }
    const webhookUrl = `${config.BOT_WEBHOOK_URL.replace(/\/$/, "")}/telegram/${config.TELEGRAM_WEBHOOK_SECRET || "webhook"}`;
    await bot.api.setWebhook(
      webhookUrl,
      config.TELEGRAM_WEBHOOK_SECRET ? { secret_token: config.TELEGRAM_WEBHOOK_SECRET } : {}
    );
    logger.info({ webhookUrl }, "LifeBook Bot webhook is ready");
  } else {
    runner = run(bot);
    reminderTimer = startReminderLoop(bot);
    logger.info({ port: config.PORT }, "LifeBook Bot polling is ready");
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down LifeBook Bot");
    if (reminderTimer) {
      clearInterval(reminderTimer);
    }
    await runner?.stop();
    await server.close();
    await closeRedis();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (error) => {
  logger.fatal({ err: error }, "LifeBook Bot failed to start");
  await prisma.$disconnect();
  process.exit(1);
});
