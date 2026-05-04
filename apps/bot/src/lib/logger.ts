import pino, { type LoggerOptions } from "pino";
import { config } from "../config.js";

const loggerOptions: LoggerOptions = {
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "TELEGRAM_BOT_TOKEN",
      "OPENAI_API_KEY",
      "DATABASE_URL",
      "req.headers.authorization",
      "rawText",
      "transcript",
      "content"
    ],
    censor: "[redacted]"
  }
};

if (config.NODE_ENV === "development") {
  loggerOptions.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss"
    }
  };
}

export const logger = pino(loggerOptions);
