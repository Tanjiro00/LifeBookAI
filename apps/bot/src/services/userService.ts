import type { Context } from "grammy";
import { ReminderFrequency, UserState, type User } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { assertTransition, type UserStateValue } from "../domain/stateMachine.js";

function defaultTimezoneFor(languageCode?: string | null): string {
  // Best-effort: most users will manually adjust later. Keep Moscow only for ru-* locales.
  if (!languageCode) return "Europe/Moscow";
  const lc = languageCode.toLowerCase();
  if (lc.startsWith("ru")) return "Europe/Moscow";
  if (lc.startsWith("uk")) return "Europe/Kyiv";
  if (lc.startsWith("kk")) return "Asia/Almaty";
  if (lc.startsWith("en-gb")) return "Europe/London";
  if (lc.startsWith("en")) return "America/Los_Angeles";
  return "Europe/Moscow";
}

export async function ensureTelegramUser(ctx: Context): Promise<User> {
  if (!ctx.from) {
    throw new Error("Telegram update does not include a user.");
  }

  const telegramId = BigInt(ctx.from.id);

  const user = await prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      username: ctx.from.username ?? null,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name ?? null,
      languageCode: ctx.from.language_code ?? null,
      timezone: defaultTimezoneFor(ctx.from.language_code)
    },
    update: {
      username: ctx.from.username ?? null,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name ?? null,
      languageCode: ctx.from.language_code ?? null
    }
  });

  await ensureDefaultBook(user.id);
  return user;
}

export async function ensureDefaultBook(userId: string): Promise<void> {
  const existing = await prisma.book.findFirst({ where: { userId } });
  if (existing) {
    return;
  }

  await prisma.book.create({
    data: {
      userId,
      title: "Год, когда я стал собой",
      subtitle: "Личная книга жизни"
    }
  });
}

export async function setUserState(user: User, nextState: UserStateValue): Promise<User> {
  assertTransition(user.state as UserStateValue, nextState);
  return prisma.user.update({
    where: { id: user.id },
    data: { state: nextState as UserState }
  });
}

export async function markOnboardingReady(userId: string): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: {
      state: UserState.READY,
      onboardingDone: true
    }
  });
}

// During onboarding we move state forward step by step; once onboardingDone is true,
// changes from /settings should NOT restart the onboarding sequence.
async function nextStateForGoal(user: User): Promise<UserState> {
  return user.onboardingDone ? UserState.READY : UserState.ONBOARDING_STYLE;
}

async function nextStateForStyle(user: User): Promise<UserState> {
  return user.onboardingDone ? UserState.READY : UserState.ONBOARDING_FREQUENCY;
}

async function nextStateForFrequency(user: User, frequency: ReminderFrequency): Promise<UserState> {
  if (frequency === ReminderFrequency.MANUAL) return UserState.READY;
  return user.onboardingDone ? UserState.READY : UserState.ONBOARDING_REMINDER_DAY;
}

async function nextStateForReminderDay(user: User): Promise<UserState> {
  return user.onboardingDone ? UserState.READY : UserState.ONBOARDING_REMINDER_TIME;
}

export async function updateWritingGoal(userId: string, writingGoal: string): Promise<User> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return prisma.user.update({
    where: { id: userId },
    data: { writingGoal, state: await nextStateForGoal(user) }
  });
}

export async function updateWritingStyle(userId: string, writingStyle: string): Promise<User> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return prisma.user.update({
    where: { id: userId },
    data: { writingStyle, state: await nextStateForStyle(user) }
  });
}

export async function updateReminderFrequency(userId: string, frequency: ReminderFrequency): Promise<User> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const nextState = await nextStateForFrequency(user, frequency);
  const data =
    frequency === ReminderFrequency.MANUAL
      ? {
          reminderFrequency: frequency,
          state: nextState,
          reminderDay: null,
          reminderTime: null
        }
      : {
          reminderFrequency: frequency,
          state: nextState
        };

  return prisma.user.update({
    where: { id: userId },
    data
  });
}

export async function updateReminderDay(userId: string, reminderDay: number): Promise<User> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return prisma.user.update({
    where: { id: userId },
    data: { reminderDay, state: await nextStateForReminderDay(user) }
  });
}

export async function updateReminderTime(userId: string, reminderTime: string): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: { reminderTime, state: UserState.READY }
  });
}

export async function getSavedChapterCount(userId: string): Promise<number> {
  return prisma.chapter.count({
    where: {
      userId,
      isSaved: true
    }
  });
}
