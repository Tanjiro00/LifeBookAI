import { transcribeAudio } from "@lifebook/ai";

export type TranscribeAudioJobData = {
  filePath: string;
};

export async function transcribeAudioJob(data: TranscribeAudioJobData) {
  return transcribeAudio(data.filePath);
}

