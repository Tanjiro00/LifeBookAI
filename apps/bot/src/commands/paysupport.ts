import type { Context } from "grammy";
import { t } from "../lib/i18n.js";

export async function sendPaySupport(ctx: Context): Promise<void> {
  await ctx.reply(
    t(
      ctx,
      [
        "Поддержка платежей",
        "",
        "Платежи через Telegram Stars. Я храню telegram_payment_charge_id, чтобы можно было обработать поддержку или возврат.",
        "",
        "Если оплата прошла, но Pro не включился — пришли сюда дату покупки или номер платежа."
      ].join("\n"),
      [
        "Payment support",
        "",
        "Payments go through Telegram Stars. I store telegram_payment_charge_id so support and refunds work.",
        "",
        "If you paid but Pro didn't activate — send me the purchase date or payment id."
      ].join("\n")
    )
  );
}
