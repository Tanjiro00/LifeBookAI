-- Add follow-up question opt-out + streak tracking to User
ALTER TABLE "User" ADD COLUMN "followupEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "streakWeeks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastEntryWeekStart" TIMESTAMP(3);

-- Cover versioning so we regenerate at milestones (3, 10, 25, 52 entries).
ALTER TABLE "Book" ADD COLUMN "coverVersion" INTEGER NOT NULL DEFAULT 0;
