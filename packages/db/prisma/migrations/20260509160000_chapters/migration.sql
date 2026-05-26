-- Sprint 4.1 — Chapter promotion + BookPart.
--
-- Chapter: legacy 1:1-with-Entry artifact becomes a first-class manuscript
-- unit synthesized from 4-6 Pages. Adds intro (biographer bridge prose),
-- themes[], status enum, orderIndex, periodStart/End, partId.
--
-- BookPart: top-level division (Part I / Part II). Chapters belong to at most
-- one part. Parts are introduced post-13 pages once the manuscript shape is
-- visible.
--
-- UserState: two new states for the chapter rename / intro-edit conversations.

-- ─── New enum ──────────────────────────────────────────────────────────────
CREATE TYPE "ChapterStatus" AS ENUM ('DRAFT', 'USER_APPROVED', 'LOCKED_FOR_PDF');

-- ─── UserState additions ───────────────────────────────────────────────────
ALTER TYPE "UserState" ADD VALUE IF NOT EXISTS 'AWAITING_CHAPTER_RENAME';
ALTER TYPE "UserState" ADD VALUE IF NOT EXISTS 'AWAITING_CHAPTER_INTRO_DETAIL';

-- ─── BookPart ──────────────────────────────────────────────────────────────
CREATE TABLE "BookPart" (
  "id"         TEXT         PRIMARY KEY,
  "userId"     TEXT         NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "bookId"     TEXT,
  "title"      TEXT         NOT NULL,
  "intro"      TEXT,
  "orderIndex" INTEGER      NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL
);
CREATE INDEX "BookPart_userId_orderIndex_idx" ON "BookPart" ("userId", "orderIndex");
CREATE INDEX "BookPart_bookId_orderIndex_idx" ON "BookPart" ("bookId", "orderIndex");

-- ─── Chapter additions ─────────────────────────────────────────────────────
ALTER TABLE "Chapter"
  ADD COLUMN "partId"      TEXT,
  ADD COLUMN "intro"       TEXT,
  ADD COLUMN "themes"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "status"      "ChapterStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "orderIndex"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "periodStart" TIMESTAMPTZ,
  ADD COLUMN "periodEnd"   TIMESTAMPTZ;

-- Chapter.content used to be NOT NULL with no default. Older code paths still
-- set it; new chapter rows synthesised by Sprint 4 leave content="" and rely
-- on intro + linked Pages instead. Provide a default so future inserts that
-- skip content don't fail.
ALTER TABLE "Chapter" ALTER COLUMN "content" SET DEFAULT '';

ALTER TABLE "Chapter"
  ADD CONSTRAINT "Chapter_partId_fkey"
  FOREIGN KEY ("partId") REFERENCES "BookPart"("id") ON DELETE SET NULL;

CREATE INDEX "Chapter_userId_status_orderIndex_idx" ON "Chapter" ("userId", "status", "orderIndex");
CREATE INDEX "Chapter_userId_partId_idx"            ON "Chapter" ("userId", "partId");

-- Backfill existing rows: legacy chapters get USER_APPROVED status (they were
-- already shown to users) and orderIndex by createdAt.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" ASC) - 1 AS rn
  FROM "Chapter"
)
UPDATE "Chapter" c
   SET "orderIndex" = r.rn,
       "status"     = 'USER_APPROVED'
  FROM ranked r
 WHERE c."id" = r."id";
