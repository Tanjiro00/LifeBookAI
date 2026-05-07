import type { EntryOutput, GenerateEntryInput } from "./schemas.js";

const CYR = /[а-яё]/i;

export function detectLanguage(text: string): "ru" | "en" {
  return CYR.test(text) ? "ru" : "en";
}

function firstFragment(text: string): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .split(/[.!?\n]/)
    .map((part) => part.trim())
    .find((part) => part.length >= 12);
  return cleaned?.slice(0, 90) || text.replace(/\s+/g, " ").slice(0, 90);
}

function pickIndex(seed: string, length: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % length;
}

const RU_TEMPLATES: Array<(raw: string) => EntryOutput> = [
  (raw) => ({
    title: "Тихий понедельник",
    body: [
      `Это началось так буднично, что чуть не прошло мимо. ${firstFragment(raw)}.`,
      "Я не пытался(ась) сложить из этого историю — просто шёл(шла) сквозь неделю, замечая то одно, то другое.",
      "К среде поймал(а) себя на том, что одна мелочь не уходит. Не вывод, не урок — просто момент, который не хочется потерять.",
      "Записываю его сюда, чтобы он остался."
    ].join("\n\n"),
    quote: undefined,
    mood: ["quiet"],
    tags: ["неделя"],
    memoryUpdates: []
  }),
  (raw) => ({
    title: "Разговор, который остался",
    body: [
      `${firstFragment(raw)} — с этого началось.`,
      "Я думал(а), неделя будет про работу. А осталась она про разговор. Не длинный, не выстроенный — кто-то задал вопрос вовремя.",
      "Я не успел(а) подобрать слова в тот момент, и, может быть, поэтому помню всё дословно.",
      "Записывая это, не хочу его «обработать». Пусть остаётся как есть."
    ].join("\n\n"),
    quote: "Иногда главное в неделе говорится не тебе, а через тебя.",
    mood: ["reflective", "warm"],
    tags: ["разговор"],
    memoryUpdates: []
  }),
  (raw) => ({
    title: "Маленькое решение",
    body: [
      "Я не помню точно, в какой момент это случилось. Возможно, копилось дольше, чем неделя.",
      `Если выбирать сцену — это была вот эта: ${firstFragment(raw)}.`,
      "Я не стал(а) ничего громко решать. Решение было маленькое, почти неслышное.",
      "Через год, наверное, эта запись будет про тот момент, когда я начал(а) идти не туда, куда привык(ла)."
    ].join("\n\n"),
    quote: "Большие решения обычно начинаются как мелкая внутренняя поправка.",
    mood: ["resolute", "calm"],
    tags: ["решение"],
    memoryUpdates: []
  })
];

const EN_TEMPLATES: Array<(raw: string) => EntryOutput> = [
  (raw) => ({
    title: "A Quiet Monday",
    body: [
      `It started so plainly I almost missed it. ${firstFragment(raw)}.`,
      "I wasn't trying to make it a story. I just walked through it.",
      "By Wednesday I noticed one small thing wouldn't leave. Not a lesson — a moment I don't want to lose.",
      "Writing it here so it stays."
    ].join("\n\n"),
    quote: undefined,
    mood: ["quiet"],
    tags: ["week"],
    memoryUpdates: []
  })
];

export function mockEntry(input: GenerateEntryInput & { language?: string }): EntryOutput {
  const language = input.language || detectLanguage(input.rawEntryOrTranscript);
  const templates = language.startsWith("en") ? EN_TEMPLATES : RU_TEMPLATES;
  const idx = pickIndex(input.rawEntryOrTranscript, templates.length);
  return templates[idx]!(input.rawEntryOrTranscript);
}
