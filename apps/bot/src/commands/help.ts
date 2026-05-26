import type { Context } from "grammy";
import { t } from "../lib/i18n.js";

export async function sendHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    t(
      ctx,
      [
        "Я пишу книгу твоего года.",
        "",
        "Раз в неделю расскажи момент — голосом или текстом. Я задаю пару уточняющих вопросов и превращаю это в страницу. В декабре получаешь книгу в PDF.",
        "",
        "Команды:",
        "/new — записать момент",
        "/book — открыть мою книгу",
        "/stats — статистика года",
        "/memories — что я помню о тебе",
        "/export — скачать PDF (Pro)",
        "/settings — напоминания и план",
        "/privacy — приватность",
        "/cancel — выйти из текущего сценария",
        "",
        "Меню снизу — четыре кнопки самых частых действий."
      ].join("\n"),
      [
        "I write the book of your year.",
        "",
        "Once a week, tell me a moment — voice or text. I ask a couple of clarifying questions and turn it into a page. In December you get the book as a PDF.",
        "",
        "Commands:",
        "/new — capture a moment",
        "/book — open my book",
        "/stats — year stats",
        "/memories — what I remember about you",
        "/export — download PDF (Pro)",
        "/settings — reminders and plan",
        "/privacy — privacy",
        "/cancel — exit current flow",
        "",
        "Menu below — four buttons for the most common actions."
      ].join("\n")
    )
  );
}
