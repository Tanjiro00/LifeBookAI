import type { Context } from "grammy";

export async function sendHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      "Я помогаю собирать твою книгу жизни по одной главе.",
      "",
      "/new — написать новую главу",
      "/book — моя книга",
      "/settings — настройки",
      "/privacy — приватность",
      "/delete_last — удалить последнюю главу",
      "/export — экспорт",
      "",
      "Лучший формат: просто расскажи неделю обычными словами. Я задам пару вопросов и превращу это в главу."
    ].join("\n")
  );
}

