-- Sprint 0.6: Page versioning + transcript confirmation + EntryType
-- Adds versioning columns to Page so user revisions don't destroy history.
-- Adds a PageKind enum (was a free string column).
-- Adds Entry.transcriptConfirmed/finalInputText/entryType for the new voice flow.
-- Adds AWAITING_TRANSCRIPT_CONFIRM and AWAITING_PAGE_REVISION user states.

-- ─── New enums ──────────────────────────────────────────────────────────────
CREATE TYPE "PageKind" AS ENUM ('WEEKLY', 'PROLOGUE', 'RETROSPECTIVE', 'CHAPTER_INTRO', 'EPILOGUE');
CREATE TYPE "EntryType" AS ENUM ('WEEKLY', 'RETROSPECTIVE', 'INTAKE_SCENE');

-- ─── UserState additions ────────────────────────────────────────────────────
ALTER TYPE "UserState" ADD VALUE IF NOT EXISTS 'AWAITING_TRANSCRIPT_CONFIRM';
ALTER TYPE "UserState" ADD VALUE IF NOT EXISTS 'AWAITING_PAGE_REVISION';

-- ─── Entry additions ────────────────────────────────────────────────────────
ALTER TABLE "Entry"
  ADD COLUMN "transcriptConfirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "finalInputText"      TEXT,
  ADD COLUMN "entryType"           "EntryType" NOT NULL DEFAULT 'WEEKLY';

-- Backfill: existing Entry rows have implicit "confirmed" semantics — they were
-- already used to generate Pages, so we mark them confirmed to avoid breaking
-- old data when read by new code paths.
UPDATE "Entry" SET "transcriptConfirmed" = true WHERE "transcriptConfirmed" = false;

-- ─── Page additions ─────────────────────────────────────────────────────────
ALTER TABLE "Page"
  ADD COLUMN "teaser"          TEXT,
  ADD COLUMN "summary"         TEXT,
  ADD COLUMN "version"         INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revisionOfId"    TEXT,
  ADD COLUMN "isCurrent"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "generationPlan"  JSONB,
  ADD COLUMN "sourceContext"   JSONB,
  ADD COLUMN "manuscriptOrder" INTEGER;

-- periodStart/periodEnd may already exist on Page — guard with IF NOT EXISTS.
DO $$ BEGIN
  ALTER TABLE "Page" ADD COLUMN "periodStart" TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Page" ADD COLUMN "periodEnd" TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ─── Page.kind: TEXT → enum PageKind ───────────────────────────────────────
-- Existing values are 'WEEKLY' or 'PROLOGUE' (per current code paths). Cast
-- via a temporary column to avoid drop-recreate of indexes.
ALTER TABLE "Page" ADD COLUMN "kind_new" "PageKind";
UPDATE "Page" SET "kind_new" =
  CASE
    WHEN "kind" = 'PROLOGUE'      THEN 'PROLOGUE'::"PageKind"
    WHEN "kind" = 'RETROSPECTIVE' THEN 'RETROSPECTIVE'::"PageKind"
    WHEN "kind" = 'CHAPTER_INTRO' THEN 'CHAPTER_INTRO'::"PageKind"
    WHEN "kind" = 'EPILOGUE'      THEN 'EPILOGUE'::"PageKind"
    ELSE 'WEEKLY'::"PageKind"
  END;
ALTER TABLE "Page" ALTER COLUMN "kind_new" SET NOT NULL;
ALTER TABLE "Page" ALTER COLUMN "kind_new" SET DEFAULT 'WEEKLY';
DROP INDEX IF EXISTS "Page_userId_kind_idx";
ALTER TABLE "Page" DROP COLUMN "kind";
ALTER TABLE "Page" RENAME COLUMN "kind_new" TO "kind";

-- ─── New Page indexes ──────────────────────────────────────────────────────
CREATE INDEX "Page_userId_kind_idx"             ON "Page" ("userId", "kind");
CREATE INDEX "Page_userId_isCurrent_kind_idx"   ON "Page" ("userId", "isCurrent", "kind");
CREATE INDEX "Page_revisionOfId_idx"            ON "Page" ("revisionOfId");

-- One current version per revision chain. If revisionOfId is null, the chain key
-- is the page's own id; otherwise it's the root revisionOfId. Enforced via a
-- partial unique index on the chain key + isCurrent.
CREATE UNIQUE INDEX "Page_one_current_per_chain_idx"
  ON "Page" (COALESCE("revisionOfId", "id"))
  WHERE "isCurrent" = true;
