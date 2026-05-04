import { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";

export const prisma = new PrismaClient({
  log: [
    { level: "error", emit: "event" },
    { level: "warn", emit: "event" }
  ]
});

prisma.$on("error", (event) => logger.error({ err: event }, "Prisma error"));
prisma.$on("warn", (event) => logger.warn({ event }, "Prisma warning"));

