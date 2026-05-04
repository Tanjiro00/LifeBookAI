import { UserState } from "@prisma/client";
import type { Context } from "grammy";
import { transcribeAudio } from "@lifebook/ai";
import { questionsKeyboard, voiceTranscriptKeyboard } from "../keyboards/chapterActions.js";
import {
  createTextEntry,
  createVoiceEntry,
  formatQuestions,
  generateAndPersistChapter,
  generateAndPersistQuestions,
  latestEntryForAnswers,
  saveAnswers
} from "../services/chapterService.js";
import { canCreateAnotherChapter, freeLimitText } from "../services/subscriptions.js";
import { ensureTelegramUser } from "../services/userService.js";
import { downloadTelegramFile } from "../services/telegramFiles.js";
import { sendChapterResult } from "./chapterReview.js";
import { prisma } from "../lib/db.js";
import { track } from "../services/analytics.js";
import { paywallKeyboard } from "../keyboards/settings.js";
import { replyWithFriendlyError } from "../lib/errors.js";

async function sendTyping(ctx: Context): Promise<void> {
  if (ctx.chat) {
    await ctx.api.sendChatAction(ctx.chat.id, "typing");
  }
}

export async function handleWeeklyText(ctx: Context, text: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);

  if (!(await canCreateAnotherChapter(user))) {
    track("paywall_shown", { userId: user.id });
    await ctx.reply(freeLimitText(), { reply_markup: paywallKeyboard() });
    return;
  }

  if (user.state === UserState.WAITING_FOR_ANSWERS) {
    await handleClarifyingAnswers(ctx, text);
    return;
  }

  if (user.state !== UserState.READY && user.state !== UserState.WAITING_FOR_WEEKLY_INPUT) {
    await ctx.reply("Сейчас лучше выбрать вариант кнопкой. Если хочешь начать заново, нажми /new или /cancel.");
    return;
  }

  if (text.trim().length < 20) {
    await ctx.reply("Запись получилась совсем короткой. Добавь хотя бы пару деталей: что произошло, кто был рядом, что хочется запомнить.");
    return;
  }

  track("text_entry_received", { userId: user.id, length: text.length });
  const entry = await createTextEntry(user, text);
  await ctx.reply("Принял. Сейчас разберу твою неделю и задам пару вопросов, чтобы глава получилась живой, а не поверхностной.");
  await sendTyping(ctx);

  try {
    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.GENERATING_QUESTIONS } });
    const questions = await generateAndPersistQuestions(user, entry);
    await ctx.reply(formatQuestions(questions), { reply_markup: questionsKeyboard(entry.id) });
  } catch (error) {
    await replyWithFriendlyError(ctx, error);
  }
}

export async function handleVoiceMessage(ctx: Context): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const voice = ctx.message?.voice;

  if (!voice) {
    return;
  }

  if (!(await canCreateAnotherChapter(user))) {
    track("paywall_shown", { userId: user.id });
    await ctx.reply(freeLimitText(), { reply_markup: paywallKeyboard() });
    return;
  }

  track("voice_entry_received", { userId: user.id, duration: voice.duration });
  await prisma.user.update({ where: { id: user.id }, data: { state: UserState.TRANSCRIBING_AUDIO } });
  await ctx.reply("Принял голосовое. Сейчас аккуратно расшифрую его и покажу, что понял.");

  try {
    const downloaded = await downloadTelegramFile(ctx, voice.file_id);
    const transcript = await transcribeAudio(downloaded.filePath);
    const entry = await createVoiceEntry(user, {
      telegramVoiceId: voice.file_id,
      audioUrl: downloaded.publicPath,
      transcript: transcript.transcript
    });

    await prisma.user.update({ where: { id: user.id }, data: { state: UserState.GENERATING_QUESTIONS } });
    track("voice_transcribed", { userId: user.id, entryId: entry.id });
    await ctx.reply(
      [
        "Я расшифровал голосовое.",
        "",
        "Коротко понял так:",
        `— ${transcript.transcript.slice(0, 420)}${transcript.transcript.length > 420 ? "..." : ""}`,
        "",
        "Продолжить?"
      ].join("\n"),
      { reply_markup: voiceTranscriptKeyboard(entry.id) }
    );
  } catch (error) {
    await replyWithFriendlyError(ctx, error);
  }
}

export async function generateQuestionsForEntry(ctx: Context, entryId: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const entry = await prisma.entry.findFirstOrThrow({ where: { id: entryId, userId: user.id } });
  await ctx.reply("Хорошо. Задам пару уточнений, чтобы не потерять главное.");
  await sendTyping(ctx);

  try {
    const questions = await generateAndPersistQuestions(user, entry);
    await ctx.reply(formatQuestions(questions), { reply_markup: questionsKeyboard(entry.id) });
  } catch (error) {
    await replyWithFriendlyError(ctx, error);
  }
}

export async function handleClarifyingAnswers(ctx: Context, answerText: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  const entry = await latestEntryForAnswers(user.id);

  if (!entry) {
    await ctx.reply("Не нашёл активную запись с вопросами. Можем начать новую главу через /new.");
    return;
  }

  track("answers_received", { userId: user.id, entryId: entry.id });
  await saveAnswers(entry.id, answerText);
  await generateChapterForEntry(ctx, entry.id);
}

export async function generateChapterForEntry(ctx: Context, entryId: string): Promise<void> {
  const user = await ensureTelegramUser(ctx);
  await ctx.reply(
    ["Отлично. Теперь соберу это в главу твоей книги.", "", "Сначала найду главный смысл недели, потом напишу текст в твоём стиле."].join("\n")
  );
  await sendTyping(ctx);

  try {
    const chapter = await generateAndPersistChapter(user, entryId);
    await sendChapterResult(ctx, chapter);
  } catch (error) {
    await replyWithFriendlyError(ctx, error);
  }
}
