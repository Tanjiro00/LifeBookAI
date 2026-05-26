-- Sprint 1.1 — Enable pgvector and create PageEmbedding.
--
-- Why: every page generation reads up to 3 semantically related prior pages
-- (master spec §5.2). Linear scans don't scale beyond a few hundred pages, so
-- we install pgvector and an HNSW index over a 1536-dim cosine space.
--
-- Prereq: the postgres image must be pgvector/pgvector:pg16 (see docker-compose).
-- The CREATE EXTENSION statement is idempotent, so re-applying is safe.

CREATE EXTENSION IF NOT EXISTS vector;

-- The table mirrors the Prisma `PageEmbedding` model. Note the explicit dim
-- on the vector column: Prisma's Unsupported("vector") doesn't carry the dim
-- so we set it here — pgvector enforces dimensionality at write time.
CREATE TABLE "PageEmbedding" (
  "pageId"     TEXT          PRIMARY KEY,
  "userId"     TEXT          NOT NULL,
  "model"      TEXT          NOT NULL,
  "dimensions" INTEGER       NOT NULL,
  "embedding"  vector(1536)  NOT NULL,
  "bodyHash"   TEXT          NOT NULL,
  "createdAt"  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT "PageEmbedding_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE
);

CREATE INDEX "PageEmbedding_userId_idx" ON "PageEmbedding" ("userId");

-- HNSW with cosine distance is the right index family for OpenAI embeddings:
-- it gives sub-50ms ANN at 100k rows with low recall loss at the default
-- ef_search=40. Built CONCURRENTLY would be safer in prod with traffic, but
-- for fresh deployments / migrations a blocking build is fine and faster.
CREATE INDEX "PageEmbedding_hnsw_idx"
  ON "PageEmbedding" USING hnsw ("embedding" vector_cosine_ops);
