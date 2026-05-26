-- User-chosen title flag. When true, ensureBookArtifacts must NOT overwrite the title
-- with an AI suggestion.
ALTER TABLE "Book" ADD COLUMN "titleSetByUser" BOOLEAN NOT NULL DEFAULT false;
