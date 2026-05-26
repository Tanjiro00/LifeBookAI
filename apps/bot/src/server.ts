import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { Bot } from "grammy";
import { join } from "node:path";
import { config, paths } from "./config.js";
import { getAdminMetrics } from "./services/adminService.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/db.js";
import { issueJwt, verifyJwt, verifyTelegramInitData, type MiniAppJwtPayload } from "./lib/miniAppAuth.js";
import { promRegistry } from "./lib/observability.js";
import { reviseExistingPage, rewritePageTitle } from "./services/pageRevisionService.js";
import {
  addDetailToChapterIntro,
  renameChapter,
  resplitChapter
} from "./services/chapterService.js";
import { deleteMemory, updateMemoryContent } from "./services/memoryService.js";

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

  // Sprint 5 tail — Prometheus scrape endpoint. No auth: assume scraper is
  // network-isolated. If exposing publicly, add a bearer-token check.
  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", promRegistry.contentType);
    return promRegistry.metrics();
  });

  // ─── Sprint 4.8 — Mini App auth ─────────────────────────────────────────
  // POST /api/auth/telegram { initData } → { token, user }
  // Validates the Telegram-supplied initData (HMAC), upserts the user, and
  // returns a short-lived HS256 JWT. The Mini App stores this in memory and
  // attaches it as `Authorization: Bearer <token>` to subsequent /api calls.
  app.post("/api/auth/telegram", async (request, reply) => {
    const body = (request.body ?? {}) as { initData?: string };
    const initData = body.initData ?? "";
    const verified = verifyTelegramInitData(initData);
    if (!verified.ok) {
      return reply.code(401).send({ error: "Unauthorized", reason: verified.reason });
    }
    if (!config.MINIAPP_JWT_SECRET) {
      return reply.code(500).send({ error: "Server misconfigured: MINIAPP_JWT_SECRET unset" });
    }
    const tg = verified.user;
    const user = await prisma.user.upsert({
      where: { telegramId: BigInt(tg.id) },
      create: {
        telegramId: BigInt(tg.id),
        username: tg.username ?? null,
        firstName: tg.first_name ?? null,
        lastName: tg.last_name ?? null,
        languageCode: tg.language_code ?? null
      },
      update: {
        username: tg.username ?? null,
        firstName: tg.first_name ?? null,
        lastName: tg.last_name ?? null,
        languageCode: tg.language_code ?? null
      }
    });
    const token = issueJwt({ sub: user.id, tgId: tg.id });
    return {
      token,
      ttlSeconds: config.MINIAPP_JWT_TTL_SECONDS,
      user: {
        id: user.id,
        firstName: user.firstName,
        languageCode: user.languageCode
      }
    };
  });

  // Helper for /api/* routes that require the Mini App JWT. Returns the
  // verified payload, or sends a 401 and returns null.
  // We type-erase via FastifyRequest/FastifyReply rather than chasing the
  // generics — this helper is tiny and the inputs are simple headers.
  async function requireUser(
    request: { headers: Record<string, string | string[] | undefined> },
    reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }
  ): Promise<MiniAppJwtPayload | null> {
    const rawAuth = request.headers["authorization"] ?? request.headers["Authorization"];
    const auth = Array.isArray(rawAuth) ? rawAuth[0] ?? "" : rawAuth ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) {
      reply.code(401).send({ error: "Unauthorized" });
      return null;
    }
    const verified = verifyJwt(m[1]!);
    if (!verified.ok) {
      reply.code(401).send({ error: "Unauthorized", reason: verified.reason });
      return null;
    }
    return verified.payload;
  }

  // GET /api/me — sanity check for the Mini App that auth works.
  app.get("/api/me", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, firstName: true, languageCode: true, lifeContext: true }
    });
    if (!user) return reply.code(404).send({ error: "User vanished" });
    return user;
  });

  // GET /api/manuscript — full manuscript snapshot for the BookReader view.
  // Returns parts → chapters → pages, plus prologue. Authenticated; user can
  // only see their own manuscript.
  app.get("/api/manuscript", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const userId = payload.sub;

    const [parts, chapters, allPages, book] = await Promise.all([
      prisma.bookPart.findMany({
        where: { userId },
        orderBy: { orderIndex: "asc" }
      }),
      prisma.chapter.findMany({
        where: { userId, status: { in: ["DRAFT", "USER_APPROVED", "LOCKED_FOR_PDF"] } },
        orderBy: { orderIndex: "asc" }
      }),
      prisma.page.findMany({
        where: { userId, isCurrent: true },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          chapterId: true,
          sceneTitle: true,
          sceneContent: true,
          quote: true,
          teaser: true,
          accentColor: true,
          createdAt: true,
          version: true
        }
      }),
      prisma.book.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } })
    ]);

    return {
      book: book
        ? {
            title: book.titleSetByUser ? book.title : book.aiTitle || book.title,
            subtitle: book.subtitle,
            coverUrl: book.coverUrl,
            pdfUrl: book.pdfUrl
          }
        : null,
      parts,
      chapters: chapters.map((c) => ({
        ...c,
        // Hide internal generationPlan / sourceContext from the client.
      })),
      pages: allPages
    };
  });

  // ─── Sprint 4 / Mini App write endpoints ────────────────────────────────
  // All require the JWT issued by /api/auth/telegram. We re-fetch the user
  // by id from the JWT subject — never trust client-supplied user identifiers.

  // POST /api/page/:id/revise { instruction } → { newPageId, version }
  app.post("/api/page/:id/revise", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { instruction?: string };
    if (!body.instruction || body.instruction.length < 2) {
      return reply.code(400).send({ error: "instruction required" });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return reply.code(404).send({ error: "User not found" });
    try {
      const next = await reviseExistingPage({ user, pageId: id, userInstruction: body.instruction });
      return { newPageId: next.id, version: next.version };
    } catch (err) {
      logger.warn({ err: { message: (err as Error).message }, userId: user.id, pageId: id }, "miniapp revise failed");
      return reply.code(400).send({ error: "Revise failed" });
    }
  });

  // POST /api/page/:id/retitle { instruction? } → { newPageId, title, version }
  app.post("/api/page/:id/retitle", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { instruction?: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return reply.code(404).send({ error: "User not found" });
    try {
      const next = await rewritePageTitle({
        user,
        pageId: id,
        ...(body.instruction ? { userInstruction: body.instruction } : {})
      });
      return { newPageId: next.id, title: next.sceneTitle, version: next.version };
    } catch (err) {
      logger.warn({ err: { message: (err as Error).message }, userId: user.id, pageId: id }, "miniapp retitle failed");
      return reply.code(400).send({ error: "Retitle failed" });
    }
  });

  // POST /api/chapter/:id/rename { title } → { id, title, version }
  app.post("/api/chapter/:id/rename", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { title?: string };
    if (!body.title || body.title.length < 2) {
      return reply.code(400).send({ error: "title required" });
    }
    const updated = await renameChapter(payload.sub, id, body.title);
    if (!updated) return reply.code(404).send({ error: "Chapter not found" });
    return { id: updated.id, title: updated.title, version: updated.version };
  });

  // POST /api/chapter/:id/intro_detail { detail } → { id, intro, version }
  app.post("/api/chapter/:id/intro_detail", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { detail?: string };
    if (!body.detail || body.detail.length < 2) {
      return reply.code(400).send({ error: "detail required" });
    }
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { languageCode: true }
    });
    const language: "ru" | "en" = (user?.languageCode || "").toLowerCase().startsWith("en") ? "en" : "ru";
    const updated = await addDetailToChapterIntro(payload.sub, id, body.detail, language);
    if (!updated) return reply.code(404).send({ error: "Chapter not found" });
    return { id: updated.id, intro: updated.intro, version: updated.version };
  });

  // POST /api/chapter/:id/approve → { id, status: USER_APPROVED }
  app.post("/api/chapter/:id/approve", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const { id } = request.params as { id: string };
    const chapter = await prisma.chapter.findFirst({
      where: { id, userId: payload.sub },
      select: { id: true, status: true }
    });
    if (!chapter) return reply.code(404).send({ error: "Chapter not found" });
    if (chapter.status === "LOCKED_FOR_PDF") {
      return { id: chapter.id, status: chapter.status, alreadyLocked: true };
    }
    const updated = await prisma.chapter.update({
      where: { id: chapter.id },
      data: { status: "USER_APPROVED" }
    });
    return { id: updated.id, status: updated.status };
  });

  // POST /api/chapter/:id/resplit → { ok }
  app.post("/api/chapter/:id/resplit", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const { id } = request.params as { id: string };
    const ok = await resplitChapter(payload.sub, id);
    if (!ok) return reply.code(400).send({ error: "Cannot resplit (chapter not draft)" });
    return { ok: true };
  });

  // GET /api/memories → MemoryDto[]
  app.get("/api/memories", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const memories = await prisma.memory.findMany({
      where: { userId: payload.sub },
      orderBy: [{ type: "asc" }, { confidence: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        type: true,
        category: true,
        title: true,
        content: true,
        confidence: true,
        aliases: true,
        sourcePageIds: true,
        doNotUse: true,
        createdAt: true,
        updatedAt: true
      }
    });
    return memories;
  });

  // POST /api/memories/:id/edit { content } → MemoryDto
  app.post("/api/memories/:id/edit", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { content?: string };
    if (!body.content || body.content.length < 2) {
      return reply.code(400).send({ error: "content required" });
    }
    const ok = await updateMemoryContent(payload.sub, id, body.content);
    if (!ok) return reply.code(404).send({ error: "Memory not found" });
    const updated = await prisma.memory.findUnique({ where: { id } });
    return updated;
  });

  // DELETE /api/memories/:id → { ok }
  app.delete("/api/memories/:id", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const { id } = request.params as { id: string };
    const ok = await deleteMemory(payload.sub, id);
    if (!ok) return reply.code(404).send({ error: "Memory not found" });
    return { ok: true };
  });

  // POST /api/memories/:id/do_not_use → { ok }
  app.post("/api/memories/:id/do_not_use", async (request, reply) => {
    const payload = await requireUser(request, reply);
    if (!payload) return;
    const { id } = request.params as { id: string };
    const updated = await prisma.memory.updateMany({
      where: { id, userId: payload.sub },
      data: { doNotUse: true }
    });
    if (updated.count === 0) return reply.code(404).send({ error: "Memory not found" });
    return { ok: true };
  });

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
        titleSetByUser: true,
        subtitle: true,
        coverUrl: true,
        pdfUrl: true,
        createdAt: true
      }
    });
    if (!book) return reply.code(404).send({ error: "Not found" });

    const allPages = await prisma.page.findMany({
      where: { userId: book.userId, isCurrent: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        chapterId: true,
        sceneTitle: true,
        sceneContent: true,
        quote: true,
        accentColor: true,
        createdAt: true
      }
    });

    // Sprint 4.12 — chapters drive the visible structure of the book in
    // LivingBook; we expose them alongside pages so the public preview can
    // render «Chapter N · title · intro» divider groups instead of by-month.
    const chapters = await prisma.chapter.findMany({
      where: {
        userId: book.userId,
        status: { in: ["DRAFT", "USER_APPROVED", "LOCKED_FOR_PDF"] }
      },
      orderBy: { orderIndex: "asc" },
      select: {
        id: true,
        title: true,
        subtitle: true,
        intro: true,
        themes: true,
        orderIndex: true,
        periodStart: true,
        periodEnd: true
      }
    });

    // Prologue: ALL PROLOGUE pages, in creation order (which matches chapter order).
    // Returned separately so the web app can render them as a multi-page prologue
    // section ahead of the weekly entries.
    const prologuePages = allPages
      .filter((p) => p.kind === "PROLOGUE")
      .map((p) => ({
        id: p.id,
        sceneTitle: p.sceneTitle,
        sceneContent: p.sceneContent,
        quote: p.quote,
        accentColor: p.accentColor,
        createdAt: p.createdAt
      }));
    const entries = allPages.filter((p) => p.kind !== "PROLOGUE");

    // Mirror the bot's title resolution: user-chosen wins over AI suggestion.
    const displayedTitle = book.titleSetByUser ? book.title : (book.aiTitle || book.title);

    return {
      title: displayedTitle,
      subtitle: book.subtitle,
      coverUrl: book.coverUrl,
      pdfUrl: book.pdfUrl,
      createdAt: book.createdAt,
      prologue: prologuePages, // [] when intake produced no chapters
      entries,
      chapters
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
