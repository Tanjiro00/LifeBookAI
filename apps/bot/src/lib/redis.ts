import { Redis } from "ioredis";
import { config } from "../config.js";

let redis: Redis | undefined;

export function getRedis(): Redis {
  redis ??= new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = undefined;
  }
}
