import type { Context } from "grammy";
import { prisma } from "../lib/db.js";
import { ensureTelegramUser } from "../services/userService.js";
import { track } from "../services/analytics.js";

export async function handlePreCheckoutQuery(ctx: Context): Promise<void> {
  if (!ctx.preCheckoutQuery) {
    return;
  }

  await ctx.answerPreCheckoutQuery(true);
}

export async function handleSuccessfulPayment(ctx: Context): Promise<void> {
  const payment = ctx.message?.successful_payment;
  if (!payment) {
    return;
  }

  const user = await ensureTelegramUser(ctx);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { isPaid: true } }),
    prisma.payment.create({
      data: {
        userId: user.id,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        providerPaymentChargeId: payment.provider_payment_charge_id,
        currency: payment.currency,
        amount: payment.total_amount,
        productCode: payment.invoice_payload,
        status: "PAID"
      }
    })
  ]);
  track("payment_completed", { userId: user.id });
  await ctx.reply("Pro включён. Теперь можно продолжать книгу без лимита глав.");
}

