import type { Context } from "grammy";

export async function sendHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      "Я пишу книгу твоего года.",
      "",
      "Раз в неделю расскажи момент — голосом или текстом. Я превращу его в страницу. В декабре получаешь книгу в PDF.",
      "",
      "Команды:",
      "/new — записать момент",
      "/book — открыть мою книгу",
      "/settings — напоминания и план",
      "/privacy — приватность",
      "/cancel — выйти из текущего сценария"
    ].join("\n")
  );
}
