import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { Bot } from "grammy";
import { config, paths } from "./config.js";
import { getAdminMetrics } from "./services/adminService.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/db.js";

export function createServer(bot: Bot) {
  const app = Fastify({
    loggerInstance: logger
  });

  void app.register(cors, { origin: true });
  void app.register(fastifyStatic, {
    root: paths.storageDir,
    prefix: "/media/",
    decorateReply: false
  });

  app.get("/health", async () => ({
    ok: true,
    service: "lifebook-bot",
    mode: config.BOT_MODE
  }));

  app.get("/admin/metrics", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") || (request.query as { token?: string }).token;
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    return getAdminMetrics();
  });

  app.get("/api/chapters/:shareToken", async (request, reply) => {
    const { shareToken } = request.params as { shareToken: string };
    const chapter = await prisma.chapter.findUnique({
      where: { shareToken },
      select: {
        title: true,
        subtitle: true,
        quote: true,
        content: true,
        createdAt: true,
        isSaved: true
      }
    });

    if (!chapter) {
      return reply.code(404).send({ error: "Not found" });
    }

    return chapter;
  });

  app.get("/api/books/:bookId", async (request, reply) => {
    const { bookId } = request.params as { bookId: string };
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: {
        title: true,
        subtitle: true,
        chapters: {
          where: { isSaved: true },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            title: true,
            quote: true,
            createdAt: true
          }
        }
      }
    });

    if (!book) {
      return reply.code(404).send({ error: "Not found" });
    }

    return book;
  });

  app.post(`/telegram/${config.TELEGRAM_WEBHOOK_SECRET || "webhook"}`, async (request, reply) => {
    if (config.TELEGRAM_WEBHOOK_SECRET) {
      const actual = request.headers["x-telegram-bot-api-secret-token"];
      if (actual !== config.TELEGRAM_WEBHOOK_SECRET) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    }

    await bot.handleUpdate(request.body as never);
    return reply.send({ ok: true });
  });

  return app;
}
