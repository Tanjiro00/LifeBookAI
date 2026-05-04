import type { Bot } from "grammy";
import { sendDueReminders } from "../services/reminders.js";

export async function sendReminderJob(bot: Bot) {
  return sendDueReminders(bot);
}

