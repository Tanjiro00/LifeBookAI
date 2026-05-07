-- Make Chapter.entryId optional (synthesized chapters have no single entry).
ALTER TABLE "Chapter" ALTER COLUMN "entryId" DROP NOT NULL;
ALTER TABLE "Chapter" DROP CONSTRAINT IF EXISTS "Chapter_entryId_fkey";
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New Page table: lightweight per-entry artifact.
CREATE TABLE "Page" (
  "id"              TEXT PRIMARY KEY,
  "userId"          TEXT NOT NULL,
  "entryId"         TEXT NOT NULL,
  "chapterId"      TEXT,
  "sceneTitle"     TEXT NOT NULL,
  "sceneContent"   TEXT NOT NULL,
  "quote"           TEXT,
  "biographerNote" TEXT,
  "mood"            TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tags"            TEXT[] DEFAULT ARRAY[]::TEXT[],
  "accentColor"    TEXT,
  "cardImageUrl"   TEXT,
  "shareToken"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "Page_entryId_key"   ON "Page"("entryId");
CREATE UNIQUE INDEX "Page_shareToken_key" ON "Page"("shareToken");
CREATE INDEX "Page_userId_createdAt_idx"  ON "Page"("userId", "createdAt");
CREATE INDEX "Page_userId_chapterId_idx"  ON "Page"("userId", "chapterId");

ALTER TABLE "Page" ADD CONSTRAINT "Page_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_chapterId_fkey"
  FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
