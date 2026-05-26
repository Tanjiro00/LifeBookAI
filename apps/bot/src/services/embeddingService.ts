import { embedText, hashBody } from "@lifebook/ai";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";

// Sprint 1.2 — Persistence wrapper around @lifebook/ai's embedText.
//
// Idempotency: every call computes a SHA-256 of the body and skips the OpenAI
// roundtrip if the stored bodyHash matches. The queue handler, the live page
// creation path and the backfill script all funnel through this single function
// so we never embed the same body twice.
//
// Pgvector vector literals: pgvector accepts vectors as `[v1,v2,...]` strings.
// We don't use Prisma's typed insert (Unsupported(vector) lacks a setter) — we
// go through `$executeRaw` for the upsert.

export type EmbedPageResult =
  | { status: "skipped"; reason: "no_body" }
  | { status: "skipped"; reason: "unchanged"; bodyHash: string }
  | { status: "embedded"; bodyHash: string; model: string; dimensions: number };

export async function embedPage(pageId: string): Promise<EmbedPageResult> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, userId: true, sceneTitle: true, sceneContent: true, summary: true }
  });
  if (!page) {
    logger.warn({ pageId }, "embedPage: page not found");
    return { status: "skipped", reason: "no_body" };
  }

  // Embed the title + body + summary as one document. Including the summary
  // helps semantic match when a later entry mentions the same topic in
  // different surface words ("моя бабушка" vs "babushka").
  const document = [page.sceneTitle, page.sceneContent, page.summary ?? ""]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!document) {
    return { status: "skipped", reason: "no_body" };
  }

  const newHash = hashBody(document);
  const existing = await prisma.pageEmbedding.findUnique({
    where: { pageId },
    select: { bodyHash: true }
  });
  if (existing && existing.bodyHash === newHash) {
    return { status: "skipped", reason: "unchanged", bodyHash: newHash };
  }

  const result = await embedText({ text: document });

  // Upsert via raw SQL — Prisma can't type pgvector's vector(N) directly. We
  // pass the embedding as a `[a,b,c]`-style literal (pgvector's text format).
  const literal = `[${result.embedding.join(",")}]`;
  await prisma.$executeRaw`
    INSERT INTO "PageEmbedding" ("pageId", "userId", "model", "dimensions", "embedding", "bodyHash", "createdAt", "updatedAt")
    VALUES (
      ${page.id},
      ${page.userId},
      ${result.model},
      ${result.dimensions},
      ${literal}::vector,
      ${result.bodyHash},
      NOW(),
      NOW()
    )
    ON CONFLICT ("pageId") DO UPDATE
      SET "model"      = EXCLUDED."model",
          "dimensions" = EXCLUDED."dimensions",
          "embedding"  = EXCLUDED."embedding",
          "bodyHash"   = EXCLUDED."bodyHash",
          "updatedAt"  = NOW();
  `;

  logger.info(
    { event: "embedding.stored", pageId: page.id, userId: page.userId, model: result.model, dimensions: result.dimensions, bodyHash: newHash },
    "embedPage stored"
  );
  return { status: "embedded", bodyHash: newHash, model: result.model, dimensions: result.dimensions };
}
