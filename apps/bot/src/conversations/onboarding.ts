import { ReminderFrequency, UserState } from "@prisma/client";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { generateProloguePage, PROLOGUE_TOTAL_PAGES, type EntryOutput } from "@lifebook/ai";
import { ensureTelegramUser, markOnboardingReady } from "../services/userService.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { identifyUser, track } from "../services/analytics.js";
import { t, isEnglish } from "../lib/i18n.js";
import {
  INTAKE_QUESTIONS,
  getIntakeQuestion,
  recordIntakeAnswer,
  totalIntakeQuestions
} from "../services/intakeService.js";
import {
  setIntakeIndex,
  getIntakeIndex,
  clearIntakeIndex
} from "../lib/pending.js";
import { createProloguePage } from "../services/pageService.js";
import { bookPreviewUrl } from "../services/storage.js";
// Sprint 0.1 — prologue pages use the same delivery contract as weekly pages.
import { deliverWeeklyPage } from "../services/pageDeliveryService.js";
import { refreshLifeContext } from "../services/lifeContextService.js";
import { mainMenuKeyboard } from "../keyboards/mainMenu.js";
import { generateShareToken } from "../services/pageService.js";
import { isTelegramInlineUrl } from "../services/urls.js";

const DAY_NAMES_RU: Record<number, string> = {
  1: "в понедельник",
  2: "во вторник",
  3: "в среду",
  4: "в четверг",
  5: "в пятницу",
  6: "в субботу",
  7: "в воскресенье"
};
const DAY_NAMES_EN: Record<number, string> = {
  1: "on Monday", 2: "on Tuesday", 3: "on Wednesday", 4: "on Thursday",
  5: "on Friday", 6: "on Saturday", 7: "on Sunday"
};

// ── Reminder preset (now upfront, not after first entry) ────────────────────

export async function applyReminderPreset(ctx: Context, code: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const wasOnboarding = !user.onboardingDone;

  const [freqRaw, dayRaw, time] = code.split(":") as [string, string, string?];
  const frequency = freqRaw as ReminderFrequency;

  const data: Parameters<typeof prisma.user.update>[0]["data"] = { reminderFrequency: frequency };
  if (frequency === ReminderFrequency.MANUAL) {
    data.reminderDay = null;
    data.reminderTime = null;
  } else {
    data.reminderDay = Number(dayRaw) || null;
    data.reminderTime = time && /^\d{2}:\d{2}$/.test(time) ? time : null;
  }

  await prisma.user.update({ where: { id: user.id }, data });

  if (wasOnboarding) {
    // Move state to INTAKE — but DON'T flip onboardingDone yet. We'll flip it after
    // the Prologue is generated, so until then `reminders.ts` won't try to nudge a
    // user who hasn't actually finished onboarding.
    await prisma.user.update({
      where: { id: user.id },
      data: { state: UserState.ONBOARDING_INTAKE }
    });
    track("intake_started", { userId: user.id });
    await ctx.reply(presetConfirmation(ctx, frequency, dayRaw, time));
    await sendIntakeIntro(ctx);
    await sendIntakeQuestion(ctx, 0);
    return;
  }

  // Returning user changing reminder via /settings — just confirm.
  await ctx.reply(presetConfirmation(ctx, frequency, dayRaw, time));
}

function presetConfirmation(ctx: Context, freq: string, dayRaw: string | undefined, time: string | undefined): string {
  const en = isEnglish(ctx);
  if (freq === "MANUAL") return t(ctx, "Хорошо. Возвращайся когда захочешь — пиши, я отвечу.", "Okay. Come back whenever — write me anytime.");
  if (freq === "MONTHLY")
    return t(
      ctx,
      `Хорошо. Напомню раз в две-три недели${time ? ` в ${time}` : ""}.`,
      `Okay. I'll nudge every couple of weeks${time ? ` at ${time}` : ""}.`
    );
  const days = en ? DAY_NAMES_EN : DAY_NAMES_RU;
  const day = dayRaw ? days[Number(dayRaw)] : null;
  if (day && time) {
    return t(ctx, `Хорошо. Напомню ${day} в ${time}.`, `Okay. I'll nudge ${day} at ${time}.`);
  }
  return t(ctx, "Хорошо. Напомню через неделю.", "Okay. I'll nudge in a week.");
}

// ── Intake interview ────────────────────────────────────────────────────────

async function sendIntakeIntro(ctx: Context): Promise<void> {
  await ctx.reply(
    t(
      ctx,
      [
        "Прежде чем писать первую неделю — расскажи мне немного о себе.",
        "",
        `Это ${totalIntakeQuestions()} коротких вопросов про твою жизнь до этого года: откуда ты, кто рядом, что важно. На основе ответов я напишу пролог книги.`,
        "",
        "Можно отвечать голосом или текстом. Любой вопрос можно пропустить — я допишу позже."
      ].join("\n"),
      [
        "Before I write the first week — tell me a little about yourself.",
        "",
        `${totalIntakeQuestions()} short questions about your life before this year: where you're from, who's close, what matters. Based on your answers I'll write the book's prologue.`,
        "",
        "Voice or text — both work. Any question can be skipped; I can revisit later."
      ].join("\n")
    )
  );
}

export async function sendIntakeQuestion(ctx: Context, index: number): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const q = getIntakeQuestion(index);
  if (!q) {
    await finalizeIntake(ctx);
    return;
  }
  await setIntakeIndex(user.id, index);

  const total = totalIntakeQuestions();
  const header = t(ctx, `Вопрос ${index + 1} из ${total}`, `Question ${index + 1} of ${total}`);
  const text = isEnglish(ctx) ? q.en : q.ru;

  const kb = new InlineKeyboard()
    .text(t(ctx, "Пропустить", "Skip"), `intake:skip:${index}`)
    .text(t(ctx, "Пропустить все", "Skip all"), "intake:skipall");

  await ctx.reply([header, "", text].join("\n"), { reply_markup: kb });
}

// Called from the message handler when user.state === ONBOARDING_INTAKE.
export async function handleIntakeAnswer(ctx: Context, text: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const index = (await getIntakeIndex(user.id)) ?? 0;

  const language = isEnglish(ctx) ? "en" : "ru";
  try {
    await recordIntakeAnswer({
      userId: user.id,
      questionIndex: index,
      answer: text,
      language
    });
  } catch (err) {
    logger.warn({ err, index }, "recordIntakeAnswer failed (continuing)");
  }

  const next = index + 1;
  if (next >= totalIntakeQuestions()) {
    await finalizeIntake(ctx);
    return;
  }
  await sendIntakeQuestion(ctx, next);
}

export async function skipIntakeQuestion(ctx: Context, index: number): Promise<void> {
  const next = index + 1;
  if (next >= totalIntakeQuestions()) {
    await finalizeIntake(ctx);
    return;
  }
  await sendIntakeQuestion(ctx, next);
}

export async function skipAllIntakeQuestions(ctx: Context): Promise<void> {
  await finalizeIntake(ctx);
}

async function finalizeIntake(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  await clearIntakeIndex(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { state: UserState.GENERATING_CHAPTER }
  });

  const language = isEnglish(ctx) ? "en" : "ru";
  const total = PROLOGUE_TOTAL_PAGES;

  const intakeMemories = await prisma.memory.findMany({
    where: { userId: user.id, category: "INTAKE" },
    orderBy: [{ type: "asc" }, { confidence: "desc" }]
  });
  const memoriesForAi = intakeMemories.map((m) => ({ type: m.type, title: m.title, content: m.content }));

  // Status message we keep editing as each page is written. Sequential generation
  // means each writer reads the previous pages, which keeps the prologue coherent
  // (no re-introducing the same scene/person across pages).
  const status = await ctx.reply(
    t(
      ctx,
      `Спасибо. Пишу твой пролог — ${total} ${pluralRuPages(total)}. Каждую следующую страницу я пишу, помня, что было на предыдущих, чтобы это была одна история, а не пять разрозненных кусков. Подожди пару минут.`,
      `Thank you. Writing your prologue — ${total} pages. I write each next page knowing what's already on the previous ones, so the result is one story, not five disconnected fragments. Give me a couple of minutes.`
    )
  );

  const previousPages: Array<{ title: string; body: string }> = [];
  const successful: Array<{ output: EntryOutput; index: number }> = [];
  let firstError: unknown = null;

  for (let pageIdx = 0; pageIdx < total; pageIdx += 1) {
    const pageNum = pageIdx + 1;
    if (status && ctx.chat) {
      await ctx.api
        .editMessageText(
          ctx.chat.id,
          status.message_id,
          t(
            ctx,
            `✍️ Пишу страницу ${pageNum} из ${total}…`,
            `✍️ Writing page ${pageNum} of ${total}…`
          )
        )
        .catch(() => {});
    }

    let output: EntryOutput;
    try {
      output = await generateProloguePage({
        pageNumber: pageNum,
        totalPages: total,
        firstName: user.firstName ?? null,
        language,
        writingStyle: user.writingStyle,
        intakeMemories: memoriesForAi,
        previousPages
      });
    } catch (err) {
      firstError ??= err;
      logger.error({ err, pageNum, userId: user.id }, "Prologue page generation failed");
      continue;
    }

    successful.push({ output, index: pageIdx });
    previousPages.push({ title: output.title, body: output.body });

    // Sprint 0.1 — prologue pages now use the unified delivery contract:
    // poster-card + teaser caption + 4 buttons. Full body lives in the Mini App.
    try {
      const page = await createProloguePage({ user, output });
      await deliverWeeklyPage(ctx, page);
    } catch (err) {
      logger.warn({ err, pageNum }, "Prologue persist/deliver failed");
      // No fallback dump-the-body in chat — that's exactly what the new contract
      // forbids. Instead nudge the user toward the book.
      await ctx.reply(
        t(
          ctx,
          "Страница пролога сохранена — открой её в /book.",
          "Prologue page saved — open it via /book."
        )
      );
    }
  }

  if (status && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
  }

  if (successful.length === 0) {
    logger.error({ err: firstError, userId: user.id }, "All prologue pages failed");
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.READY } });
    await markOnboardingReady(user.id);
    await ctx.reply(
      t(
        ctx,
        "Не получилось собрать пролог сейчас, но я запомнил всё, что ты рассказал. Расскажи момент этой недели — начнём первую страницу.",
        "Couldn't build the prologue right now, but I kept everything you told me. Send this week's moment — let's open page one."
      ),
      { reply_markup: mainMenuKeyboard(ctx) }
    );
    return;
  }

  track("prologue_generated", {
    userId: user.id,
    intakeMemories: intakeMemories.length,
    pages: successful.length,
    failedPages: total - successful.length
  });

  await markOnboardingReady(user.id);
  identifyUser(user.id, { onboardingDone: true });
  track("onboarding_completed", { userId: user.id });

  // First lifeContext build — synchronous so the very first weekly entry benefits.
  await refreshLifeContext(user.id);

  // Lazy-init the book's shareToken so the "open in book" link works. Same pattern
  // as createPageForEntry, but we run it here so even users who never write a weekly
  // entry can re-read their prologue via the link.
  const book = await prisma.book.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, shareToken: true }
  });
  if (book && !book.shareToken) {
    await prisma.book.update({
      where: { id: book.id },
      data: { shareToken: generateShareToken() }
    });
  }

  // Final message — single inline button to open the prologue in the web book.
  // Persistent menu re-attached on the same message via `mainMenuKeyboard()` is
  // not possible (inline + reply keyboards are different layers), so we send the
  // menu separately below.
  const refreshedBook = await prisma.book.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, shareToken: true }
  });
  const finalText = t(
    ctx,
    `Это пролог твоей книги — ${successful.length} ${pluralRuPages(successful.length)}. Дальше — раз в неделю присылай момент (голосом или текстом), я буду писать страницы. Можно прямо сейчас, можно позже.`,
    `This is your book's prologue — ${successful.length} ${successful.length === 1 ? "page" : "pages"}. From now on, send one moment per week (voice or text) and I'll write the pages. Now or later — your call.`
  );

  if (refreshedBook?.shareToken) {
    const url = bookPreviewUrl(refreshedBook.shareToken);
    const linkButtonLabel = t(ctx, "📖 Прочитать пролог в книге", "📖 Read prologue in the book");
    const inline =
      url.startsWith("https://") && isTelegramInlineUrl(url)
        ? new InlineKeyboard().webApp(linkButtonLabel, url)
        : isTelegramInlineUrl(url)
          ? new InlineKeyboard().url(linkButtonLabel, url)
          : new InlineKeyboard().text(linkButtonLabel, `preview:book:${refreshedBook.id}`);
    await ctx.reply(finalText, { reply_markup: inline });
  } else {
    await ctx.reply(finalText);
  }

  // Persistent reply-keyboard for everyday navigation, separate message.
  await ctx.reply(t(ctx, "Меню — снизу.", "Menu below."), { reply_markup: mainMenuKeyboard(ctx) });
}

// Russian plural for "страница" — "1 страница / 2 страницы / 5 страниц".
function pluralRuPages(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "страниц";
  if (mod10 === 1) return "страница";
  if (mod10 >= 2 && mod10 <= 4) return "страницы";
  return "страниц";
}
