-- Sprint 2.6 — Allow multiple Page versions per Entry.
--
-- Page.entryId was @unique because the original v1 model assumed 1 entry → 1 page.
-- Sprint 2's versioning model makes that invariant wrong: revisions share an
-- entryId with the original page, distinguished by version + isCurrent.
--
-- We keep entryId NOT NULL (every page still belongs to an entry), but drop the
-- unique constraint and add a regular index for the (entryId, isCurrent) lookup
-- the bot performs to find the current page for a given entry.

DROP INDEX IF EXISTS "Page_entryId_key";

CREATE INDEX IF NOT EXISTS "Page_entryId_isCurrent_idx"
  ON "Page" ("entryId", "isCurrent");
