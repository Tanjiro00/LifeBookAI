-- Sprint 5 — User voice calibration + Book cover variants + export/delete fields.

ALTER TABLE "User"
  ADD COLUMN "styleSample"          TEXT,
  ADD COLUMN "styleRecalibration"   TEXT,
  ADD COLUMN "narrativeCompass"     TEXT,
  ADD COLUMN "deletionRequestedAt"  TIMESTAMPTZ;

ALTER TABLE "Book"
  ADD COLUMN "coverVariants"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "exportCount"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "epilogue"       TEXT;

-- Helper index: the cron / job that hard-deletes after the 7-day grace period
-- needs to find soft-deleted users efficiently.
CREATE INDEX "User_deletionRequestedAt_idx"
  ON "User" ("deletionRequestedAt")
  WHERE "deletionRequestedAt" IS NOT NULL;
