CREATE TYPE "UserState" AS ENUM (
  'NEW_USER',
  'ONBOARDING_GOAL',
  'ONBOARDING_STYLE',
  'ONBOARDING_FREQUENCY',
  'ONBOARDING_REMINDER_DAY',
  'ONBOARDING_REMINDER_TIME',
  'READY',
  'WAITING_FOR_WEEKLY_INPUT',
  'TRANSCRIBING_AUDIO',
  'GENERATING_QUESTIONS',
  'WAITING_FOR_ANSWERS',
  'GENERATING_CHAPTER',
  'REVIEWING_CHAPTER',
  'CHAPTER_SAVED'
);

CREATE TYPE "EntryStatus" AS ENUM (
  'DRAFT',
  'COLLECTED',
  'TRANSCRIBING',
  'QUESTIONS_GENERATED',
  'ANSWERS_COLLECTED',
  'GENERATING_CHAPTER',
  'CHAPTER_GENERATED',
  'SAVED',
  'ARCHIVED'
);

CREATE TYPE "ReminderFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'MANUAL');

CREATE TYPE "MemoryType" AS ENUM (
  'PERSON',
  'PLACE',
  'THEME',
  'LIFE_EVENT',
  'GOAL',
  'FEAR',
  'ACHIEVEMENT',
  'PREFERENCE'
);

CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FAILED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "telegramId" BIGINT NOT NULL,
  "username" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "languageCode" TEXT,
  "timezone" TEXT,
  "state" "UserState" NOT NULL DEFAULT 'NEW_USER',
  "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
  "writingGoal" TEXT,
  "writingStyle" TEXT,
  "reminderFrequency" "ReminderFrequency" NOT NULL DEFAULT 'WEEKLY',
  "reminderDay" INTEGER,
  "reminderTime" TEXT,
  "isPaid" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Entry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rawText" TEXT,
  "telegramVoiceId" TEXT,
  "audioUrl" TEXT,
  "transcript" TEXT,
  "mood" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "status" "EntryStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClarificationQuestion" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT,
  "reason" TEXT,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answeredAt" TIMESTAMP(3),
  CONSTRAINT "ClarificationQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Chapter" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "bookId" TEXT,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "summary" TEXT,
  "content" TEXT NOT NULL,
  "quote" TEXT,
  "mood" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "people" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "places" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "keyEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1,
  "shareToken" TEXT,
  "cardImageUrl" TEXT,
  "isSaved" BOOLEAN NOT NULL DEFAULT false,
  "isPrivate" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Book" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "coverUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Memory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "MemoryType" NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "sourceChapterId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramPaymentChargeId" TEXT,
  "providerPaymentChargeId" TEXT,
  "currency" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "productCode" TEXT NOT NULL,
  "status" "PaymentStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE INDEX "User_state_idx" ON "User"("state");
CREATE INDEX "User_reminderFrequency_reminderDay_reminderTime_idx" ON "User"("reminderFrequency", "reminderDay", "reminderTime");

CREATE INDEX "Entry_userId_createdAt_idx" ON "Entry"("userId", "createdAt");
CREATE INDEX "Entry_status_idx" ON "Entry"("status");

CREATE INDEX "ClarificationQuestion_entryId_sortOrder_idx" ON "ClarificationQuestion"("entryId", "sortOrder");

CREATE UNIQUE INDEX "Chapter_entryId_key" ON "Chapter"("entryId");
CREATE UNIQUE INDEX "Chapter_shareToken_key" ON "Chapter"("shareToken");
CREATE INDEX "Chapter_userId_isSaved_createdAt_idx" ON "Chapter"("userId", "isSaved", "createdAt");
CREATE INDEX "Chapter_bookId_idx" ON "Chapter"("bookId");

CREATE INDEX "Book_userId_createdAt_idx" ON "Book"("userId", "createdAt");

CREATE INDEX "Memory_userId_type_idx" ON "Memory"("userId", "type");
CREATE INDEX "Memory_sourceChapterId_idx" ON "Memory"("sourceChapterId");

CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
CREATE INDEX "Payment_telegramPaymentChargeId_idx" ON "Payment"("telegramPaymentChargeId");

ALTER TABLE "Entry"
  ADD CONSTRAINT "Entry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClarificationQuestion"
  ADD CONSTRAINT "ClarificationQuestion_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Chapter"
  ADD CONSTRAINT "Chapter_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Chapter"
  ADD CONSTRAINT "Chapter_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Chapter"
  ADD CONSTRAINT "Chapter_bookId_fkey"
  FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Book"
  ADD CONSTRAINT "Book_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Memory"
  ADD CONSTRAINT "Memory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Memory"
  ADD CONSTRAINT "Memory_sourceChapterId_fkey"
  FOREIGN KEY ("sourceChapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

