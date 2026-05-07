import { getRedis } from "./redis.js";

export async function acquireLock(key: string, ttlMs = 30_000): Promise<boolean> {
  const redis = getRedis();
  const result = await redis.set(`lock:${key}`, "1", "PX", ttlMs, "NX");
  return result === "OK";
}

export async function releaseLock(key: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`lock:${key}`);
}

export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false }> {
  const acquired = await acquireLock(key, ttlMs);
  if (!acquired) {
    return { ok: false };
  }
  try {
    const value = await fn();
    return { ok: true, value };
  } finally {
    await releaseLock(key);
  }
}
