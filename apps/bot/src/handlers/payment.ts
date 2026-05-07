import type { Context } from "grammy";
import { prisma } from "../lib/db.js";
import { ensureTelegramUser } from "../services/userService.js";
import { findProductByCode } from "../services/subscriptions.js";
import { track } from "../services/analytics.js";
import { logger } from "../lib/logger.js";

export async function handlePreCheckoutQuery(ctx: Context): Promise<void> {
  const query = ctx.preCheckoutQuery;
  if (!query) return;

  const product = findProductByCode(query.invoice_payload.split(":")[0] || "");
  if (!product) {
    await ctx.answerPreCheckoutQuery(false, "Тариф устарел. Открой меню заново.");
    return;
  }
  if (query.total_amount !== product.amountStars) {
    await ctx.answerPreCheckoutQuery(false, "Сумма не совпадает.");
    logger.warn({ total: query.total_amount, expected: product.amountStars }, "Mismatched payment amount");
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
  const productCode = payment.invoice_payload.split(":")[0] || payment.invoice_payload;
  const product = findProductByCode(productCode);

  const now = new Date();
  const baseUntil = user.proUntil && user.proUntil > now ? user.proUntil : now;
  const days = product?.durationDays ?? 31;
  const proUntil = new Date(baseUntil.getTime() + days * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { isPaid: true, proUntil }
    }),
    prisma.payment.create({
      data: {
        userId: user.id,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        providerPaymentChargeId: payment.provider_payment_charge_id,
        currency: payment.currency,
        amount: payment.total_amount,
        productCode,
        status: "PAID"
      }
    }),
    // Clean up dangling PENDING placeholders for this user.
    prisma.payment.updateMany({
      where: { userId: user.id, status: "PENDING", productCode },
      data: { status: "FAILED" }
    })
  ]);

  track("payment_completed", { userId: user.id, productCode, days });

  const friendly =
    product?.code === "lifebook_pro_year"
      ? "Pro на год включён. Книга может расти без потолка."
      : "Pro включён на месяц. Книга может расти без потолка — продлим, когда подойдёт время.";

  await ctx.reply(friendly);
}
