-- New onboarding state: 7-question biographical intake before first weekly entry.
ALTER TYPE "UserState" ADD VALUE IF NOT EXISTS 'ONBOARDING_INTAKE';

-- Periodic AI summary of who-the-person-is, fed into every page-generation prompt
-- so the book accumulates a single narrative arc instead of 52 disconnected vignettes.
ALTER TABLE "User" ADD COLUMN "lifeContext" TEXT;
ALTER TABLE "User" ADD COLUMN "lifeContextUpdatedAt" TIMESTAMP(3);

-- Distinguish facts collected during onboarding intake from facts AI extracts later.
-- Used to (a) prioritize INTAKE memories in page-prompt context, (b) protect them
-- from auto-purge or staleness penalties.
ALTER TABLE "Memory" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'EXTRACTED';

-- Pages now have a kind. PROLOGUE is the AI-generated first page produced after
-- intake; WEEKLY is every page from a regular weekly entry. Used to exclude PROLOGUE
-- from streak/paywall counters and to render it specially in the web book view.
ALTER TABLE "Page" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'WEEKLY';
