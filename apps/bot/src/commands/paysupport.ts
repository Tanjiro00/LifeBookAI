import type { Context } from "grammy";

export async function sendPaySupport(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      "Поддержка платежей",
      "",
      "MVP готов к Telegram Stars: платежи сохраняются с telegram_payment_charge_id, чтобы можно было обработать поддержку или refund.",
      "",
      "Если оплата уже включена и что-то пошло не так, напиши сюда номер платежа или дату покупки."
    ].join("\n")
  );
}

