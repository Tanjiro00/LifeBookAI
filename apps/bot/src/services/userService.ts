import type { Context } from "grammy";
import { ReminderFrequency, UserState, type User } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { assertTransition, type UserStateValue } from "../domain/stateMachine.js";

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
      timezone: "Europe/Moscow"
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

export async function updateWritingGoal(userId: string, writingGoal: string): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: {
      writingGoal,
      state: UserState.ONBOARDING_STYLE
    }
  });
}

export async function updateWritingStyle(userId: string, writingStyle: string): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: {
      writingStyle,
      state: UserState.ONBOARDING_FREQUENCY
    }
  });
}

export async function updateReminderFrequency(userId: string, frequency: ReminderFrequency): Promise<User> {
  const nextState = frequency === ReminderFrequency.MANUAL ? UserState.READY : UserState.ONBOARDING_REMINDER_DAY;
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
  return prisma.user.update({
    where: { id: userId },
    data: {
      reminderDay,
      state: UserState.ONBOARDING_REMINDER_TIME
    }
  });
}

export async function updateReminderTime(userId: string, reminderTime: string): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: {
      reminderTime,
      state: UserState.READY
    }
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
