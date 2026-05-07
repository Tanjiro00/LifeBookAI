ALTER TABLE "User"
  ADD COLUMN "freeEntriesUsed" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Book"
  ADD COLUMN "aiTitle"         TEXT,
  ADD COLUMN "coverPromptUsed" TEXT,
  ADD COLUMN "pdfUrl"          TEXT,
  ADD COLUMN "pdfGeneratedAt"  TIMESTAMP(3);
