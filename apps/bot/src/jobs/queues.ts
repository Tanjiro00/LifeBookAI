import { Queue, Worker } from "bullmq";
import { getRedis } from "../lib/redis.js";

export const QUEUE_NAMES = {
  transcribeAudio: "lifebook.transcribe-audio",
  generateQuestions: "lifebook.generate-questions",
  generateChapter: "lifebook.generate-chapter",
  renderChapterCard: "lifebook.render-chapter-card",
  sendReminder: "lifebook.send-reminder"
} as const;

export function createQueue<T = unknown>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: getRedis() });
}

export function createWorker<T = unknown>(name: string, processor: (job: { data: T }) => Promise<void>): Worker<T> {
  return new Worker<T>(name, processor, { connection: getRedis() });
}

