-- Sprint 3.1 — Memory entity-isation + NarrativeThread.
--
-- Memory becomes a deduped entity: (userId, type, normalizedName) is unique
-- (partial — only when normalizedName is set). Adds aliases, sourcePageIds,
-- doNotUse fields. Existing rows are backfilled with normalizedName derived
-- from `title` so they immediately participate in dedupe.
--
-- New side tables:
--   - MemoryRevision: append-only history of summary changes per memory.
--   - NarrativeThread: rolling per-thread summary + tension + lastMovement.
--   - NarrativeThreadEvent: append-only log of thread movements.

-- ─── New enums ──────────────────────────────────────────────────────────────
CREATE TYPE "ThreadType" AS ENUM (
  'PERSON', 'RELATIONSHIP', 'PLACE', 'THEME', 'GOAL', 'FEAR',
  'IDENTITY', 'WORK', 'HEALTH', 'FAMILY'
);
CREATE TYPE "ThreadStatus" AS ENUM ('ACTIVE', 'DORMANT', 'RESOLVED');

-- ─── Memory additions ───────────────────────────────────────────────────────
ALTER TABLE "Memory"
  ADD COLUMN "normalizedName" TEXT,
  ADD COLUMN "aliases"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sourcePageIds"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "doNotUse"       BOOLEAN NOT NULL DEFAULT false;

-- Backfill normalizedName: lowercase + trim + collapse internal whitespace.
-- Russian stem-lite is left to the application layer (normalize.ts) — at SQL
-- time we just produce a stable lower-case key. The application can re-write
-- the column on first read if it wants the stem-lite form.
UPDATE "Memory"
   SET "normalizedName" = lower(regexp_replace(trim("title"), '\s+', ' ', 'g'))
 WHERE "normalizedName" IS NULL;

-- Dedupe BEFORE adding the unique index. Pre-Sprint-3 dev/prod data may have
-- created multiple Memory rows with the same (userId, type, title). Strategy:
--   keep the row with the highest confidence (tie-break: earliest createdAt)
--   collect all OTHER rows' titles into the kept row's aliases array
--   delete the OTHER rows
-- This is a one-time operation; future writes go through memoryReviewService
-- which always merges instead of inserting duplicates.
WITH ranked AS (
  SELECT
    "id",
    "userId",
    "type",
    "normalizedName",
    "title",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "type", "normalizedName"
      ORDER BY "confidence" DESC, "createdAt" ASC
    ) AS rn
  FROM "Memory"
  WHERE "normalizedName" IS NOT NULL
),
keepers AS (SELECT * FROM ranked WHERE rn = 1),
losers  AS (SELECT * FROM ranked WHERE rn > 1),
alias_lists AS (
  SELECT k."id" AS keeper_id, array_agg(DISTINCT l."title") AS extra_aliases
  FROM keepers k
  JOIN losers  l USING ("userId", "type", "normalizedName")
  GROUP BY k."id"
)
UPDATE "Memory" m
   SET "aliases" = (SELECT array(SELECT DISTINCT unnest(m."aliases" || a.extra_aliases))
                    FROM alias_lists a
                    WHERE a.keeper_id = m."id")
 WHERE m."id" IN (SELECT keeper_id FROM alias_lists);

DELETE FROM "Memory"
 WHERE "id" IN (
   SELECT "id" FROM (
     SELECT
       "id",
       ROW_NUMBER() OVER (
         PARTITION BY "userId", "type", "normalizedName"
         ORDER BY "confidence" DESC, "createdAt" ASC
       ) AS rn
     FROM "Memory"
     WHERE "normalizedName" IS NOT NULL
   ) r
   WHERE r.rn > 1
 );

-- Partial unique index: only enforce when normalizedName is non-null. This
-- way any future rows that intentionally skip dedupe (NULL name) don't clash.
CREATE UNIQUE INDEX "Memory_user_type_name_uniq"
  ON "Memory" ("userId", "type", "normalizedName")
  WHERE "normalizedName" IS NOT NULL;

-- ─── MemoryRevision ─────────────────────────────────────────────────────────
CREATE TABLE "MemoryRevision" (
  "id"          TEXT        PRIMARY KEY,
  "memoryId"    TEXT        NOT NULL REFERENCES "Memory"("id") ON DELETE CASCADE,
  "pageId"      TEXT,
  "oldSummary"  TEXT,
  "newSummary"  TEXT        NOT NULL,
  "reason"      TEXT,
  "changeType"  TEXT        NOT NULL DEFAULT 'add_detail',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MemoryRevision_memoryId_createdAt_idx"
  ON "MemoryRevision" ("memoryId", "createdAt");

-- ─── NarrativeThread ────────────────────────────────────────────────────────
CREATE TABLE "NarrativeThread" (
  "id"            TEXT        PRIMARY KEY,
  "userId"        TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "title"         TEXT        NOT NULL,
  "type"          "ThreadType"   NOT NULL,
  "status"        "ThreadStatus" NOT NULL DEFAULT 'ACTIVE',
  "summary"       TEXT        NOT NULL,
  "tension"       TEXT,
  "lastMovement"  TEXT,
  "people"        TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "places"        TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "themes"        TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "firstPageId"   TEXT,
  "lastPageId"    TEXT,
  "confidence"    DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL
);
CREATE INDEX "NarrativeThread_userId_status_idx"    ON "NarrativeThread" ("userId", "status");
CREATE INDEX "NarrativeThread_userId_type_idx"      ON "NarrativeThread" ("userId", "type");
CREATE INDEX "NarrativeThread_userId_updatedAt_idx" ON "NarrativeThread" ("userId", "updatedAt");

-- ─── NarrativeThreadEvent ──────────────────────────────────────────────────
CREATE TABLE "NarrativeThreadEvent" (
  "id"        TEXT        PRIMARY KEY,
  "threadId"  TEXT        NOT NULL REFERENCES "NarrativeThread"("id") ON DELETE CASCADE,
  "pageId"    TEXT        NOT NULL,
  "summary"   TEXT        NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "NarrativeThreadEvent_threadId_createdAt_idx" ON "NarrativeThreadEvent" ("threadId", "createdAt");
CREATE INDEX "NarrativeThreadEvent_pageId_idx"             ON "NarrativeThreadEvent" ("pageId");
