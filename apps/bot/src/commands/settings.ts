import type { Context } from "grammy";
import { ensureTelegramUser } from "../services/userService.js";
import { settingsActionsKeyboard } from "../keyboards/settings.js";
import { isProActive } from "../services/subscriptions.js";
import { displayTitle } from "../services/bookTitleService.js";
import { prisma } from "../lib/db.js";
import { t, isEnglish } from "../lib/i18n.js";

const DAY_LABELS_RU: Record<number, string> = {
  1: "понедельник", 2: "вторник", 3: "среда", 4: "четверг", 5: "пятница", 6: "суббота", 7: "воскресенье"
};
const DAY_LABELS_EN: Record<number, string> = {
  1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday"
};

export async function sendSettings(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const en = isEnglish(ctx);
  const days = en ? DAY_LABELS_EN : DAY_LABELS_RU;

  const book = await prisma.book.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { title: true, aiTitle: true, titleSetByUser: true }
  });
  const bookTitle = book ? displayTitle(book) : "—";

  const intakeMemoryCount = await prisma.memory.count({
    where: { userId: user.id, category: "INTAKE" }
  });
  const lifeContextLine = (() => {
    if (!user.lifeContext) {
      return t(ctx, "пока пусто", "not yet built");
    }
    const days =
      user.lifeContextUpdatedAt != null
        ? Math.floor((Date.now() - user.lifeContextUpdatedAt.getTime()) / (24 * 60 * 60 * 1000))
        : 0;
    const ageRu = days === 0 ? "сегодня" : days === 1 ? "вчера" : `${days} дн назад`;
    const ageEn = days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
    return t(
      ctx,
      `${intakeMemoryCount} фактов · обновлён ${ageRu}`,
      `${intakeMemoryCount} facts · updated ${ageEn}`
    );
  })();

  const reminderLine =
    user.reminderFrequency === "MANUAL"
      ? t(ctx, "только когда я сам(а) пишу", "only when I write")
      : `${
          user.reminderFrequency === "MONTHLY"
            ? t(ctx, "раз в 2 недели", "every other week")
            : t(ctx, "раз в неделю", "weekly")
        }${user.reminderDay ? `, ${days[user.reminderDay]}` : ""}${user.reminderTime ? ` · ${user.reminderTime}` : ""}`;

  const planLine = isProActive(user)
    ? user.proUntil
      ? t(ctx, `Pro до ${user.proUntil.toLocaleDateString("ru-RU")}`, `Pro until ${user.proUntil.toLocaleDateString("en-US")}`)
      : t(ctx, "Pro активен", "Pro active")
    : t(ctx, `Бесплатный · ${user.freeEntriesUsed} из 4 записей`, `Free · ${user.freeEntriesUsed} of 4 entries`);

  const followupLine = user.followupEnabled
    ? t(ctx, "включены", "on")
    : t(ctx, "выключены", "off");

  const lines = [
    `⚙️ ${t(ctx, "Настройки", "Settings")}`,
    "",
    `📚 ${t(ctx, "Книга", "Book")}`,
    `   ${bookTitle}`,
    "",
    `🧬 ${t(ctx, "Что я знаю о тебе", "What I know about you")}`,
    `   ${lifeContextLine}`,
    "",
    `🔔 ${t(ctx, "Напоминания", "Reminders")}`,
    `   ${reminderLine}`,
    "",
    `🌍 ${t(ctx, "Часовой пояс", "Timezone")}`,
    `   ${user.timezone || "Europe/Moscow"}`,
    "",
    `❓ ${t(ctx, "Уточняющие вопросы", "Follow-up questions")}`,
    `   ${followupLine}`,
    "",
    `💎 ${t(ctx, "План", "Plan")}`,
    `   ${planLine}`
  ];

  await ctx.reply(lines.join("\n"), {
    reply_markup: settingsActionsKeyboard(ctx, isProActive(user), Boolean(user.followupEnabled))
  });
}
