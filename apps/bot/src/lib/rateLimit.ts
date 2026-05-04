import type { Context, NextFunction } from "grammy";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<number, Bucket>();

export function rateLimit({ limit, windowMs }: { limit: number; windowMs: number }) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const id = ctx.from?.id;
    if (!id) {
      await next();
      return;
    }

    const now = Date.now();
    const bucket = buckets.get(id);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (bucket.count >= limit) {
      await ctx.reply("Слишком много сообщений подряд. Дай мне несколько секунд, чтобы не потерять контекст.");
      return;
    }

    bucket.count += 1;
    await next();
  };
}

