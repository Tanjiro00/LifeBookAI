import type { Context } from "grammy";
import { prisma } from "../lib/db.js";
import { ensureTelegramUser } from "../services/userService.js";
import { findProductByCode } from "../services/subscriptions.js";
import { identifyUser, track } from "../services/analytics.js";
import { logger } from "../lib/logger.js";
import { t } from "../lib/i18n.js";

export async function handlePreCheckoutQuery(ctx: Context): Promise<void> {
  const query = ctx.preCheckoutQuery;
  if (!query) return;

  const product = findProductByCode(query.invoice_payload.split(":")[0] || "");
  if (!product) {
    await ctx.answerPreCheckoutQuery(false, t(ctx, "Тариф устарел. Открой меню заново.", "This plan is no longer available. Reopen the menu."));
    return;
  }
  if (query.total_amount !== product.amountStars) {
    await ctx.answerPreCheckoutQuery(false, t(ctx, "Сумма не совпадает.", "Amount mismatch."));
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

  identifyUser(user.id, { isPaid: true, proUntil });
  track("payment_completed", { userId: user.id, productCode, days });

  const friendly =
    product?.code === "lifebook_pro_year"
      ? t(ctx, "Pro на год включён. Книга может расти без потолка.", "Pro is on for the year. The book grows without limits.")
      : t(ctx, "Pro включён на месяц. Книга может расти без потолка — продлим, когда подойдёт время.", "Pro is on for a month. The book grows without limits — we'll renew when the time comes.");

  await ctx.reply(friendly);
}
