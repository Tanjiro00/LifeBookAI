import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { Bot } from "grammy";
import { join } from "node:path";
import { config, paths } from "./config.js";
import { getAdminMetrics } from "./services/adminService.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/db.js";

export function createServer(bot: Bot) {
  const app = Fastify({ loggerInstance: logger });

  void app.register(cors, { origin: true });

  // Public media: entry cards, AI-generated covers, and finalized PDFs all live under /media/.
  void app.register(fastifyStatic, {
    root: paths.cardsDir,
    prefix: "/media/cards/",
    decorateReply: false
  });
  void app.register(fastifyStatic, {
    root: join(paths.storageDir, "covers"),
    prefix: "/media/covers/",
    decorateReply: false
  });
  void app.register(fastifyStatic, {
    root: join(paths.storageDir, "books"),
    prefix: "/media/books/",
    decorateReply: false
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:; frame-ancestors 'self' https://*.t.me https://web.telegram.org;"
    );
    reply.header("Referrer-Policy", "no-referrer");
    return payload;
  });

  app.get("/health", async () => ({
    ok: true,
    service: "lifebook-bot",
    mode: config.BOT_MODE
  }));

  app.get("/admin/metrics", async (request, reply) => {
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, "") ||
      (request.query as { token?: string }).token;
    if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return getAdminMetrics();
  });

  // Single book route — flat list of entries, AI cover and AI title if present.
  app.get("/api/books/:shareToken", async (request, reply) => {
    const { shareToken } = request.params as { shareToken: string };
    const book = await prisma.book.findFirst({
      where: { shareToken },
      select: {
        userId: true,
        title: true,
        aiTitle: true,
        subtitle: true,
        coverUrl: true,
        pdfUrl: true,
        createdAt: true
      }
    });
    if (!book) return reply.code(404).send({ error: "Not found" });

    const entries = await prisma.page.findMany({
      where: { userId: book.userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        sceneTitle: true,
        sceneContent: true,
        quote: true,
        accentColor: true,
        createdAt: true
      }
    });

    return {
      title: book.aiTitle || book.title,
      subtitle: book.subtitle,
      coverUrl: book.coverUrl,
      pdfUrl: book.pdfUrl,
      createdAt: book.createdAt,
      entries
    };
  });

  // Stable webhook path — secret is verified via header only.
  app.post("/telegram/webhook", async (request, reply) => {
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
