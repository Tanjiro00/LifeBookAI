import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Context } from "grammy";
import { config, paths } from "../config.js";

export async function downloadTelegramFile(ctx: Context, fileId: string, prefix = "voice"): Promise<{ filePath: string; publicPath: string }> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return file_path.");
  }

  await mkdir(paths.audioDir, { recursive: true });
  const extension = file.file_path.split(".").pop() || "ogg";
  const filename = `${prefix}-${fileId.replace(/[^a-zA-Z0-9_-]/g, "")}.${extension}`;
  const filePath = join(paths.audioDir, filename);
  const url = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Telegram file: ${response.status}`);
  }

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(filePath));

  return {
    filePath,
    publicPath: `/media/audio/${filename}`
  };
}
