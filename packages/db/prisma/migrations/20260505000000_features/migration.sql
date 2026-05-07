-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "proUntil"       TIMESTAMP(3),
  ADD COLUMN "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN "lastCatchupAt"  TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Book"
  ADD COLUMN "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Book_shareToken_key" ON "Book"("shareToken");
