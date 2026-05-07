import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { renderEntryCardPng, pickWeekColor } from "@lifebook/renderer";
import { generateEntry, detectContentLanguage } from "@lifebook/ai";

const prisma = new PrismaClient();

// Five varied entries, two months span — gives a multi-month TOC and varied accents.
const ENTRIES: Array<{ raw: string; daysAgo: number }> = [
  { daysAgo: 35, raw: "Неделя началась с сорванного звонка с командой. Я три дня пропустил книгу, к которой возвращался, и понял, что меня раздражают мелочи, которые раньше не трогали. В пятницу вечером сел на балконе с кофе. Долго ничего не делал." },
  { daysAgo: 28, raw: "В субботу сходили с Машей на старый рынок. Она показывала, какие чашки ей напоминают её бабушку. Я понял, что почти ничего не помню про свою бабушку — её голос, что-то конкретное. Это меня кольнуло." },
  { daysAgo: 21, raw: "Понедельник был странным. На работе обсуждали уход одного из ребят, и я поймал себя на мысли, что завидую — не уходу, а тому что он точно знает, чего хочет дальше. Вечером долго гулял." },
  { daysAgo: 14, raw: "Поговорил с мамой. Она спросила, как у меня с проектом. Я начал отвечать как обычно — что всё нормально — и в середине фразы остановился. Сказал что устал. Она ничего не ответила, просто помолчала." },
  { daysAgo: 7, raw: "Воскресенье. Утро было тихим. Я заметил, что впервые за месяц не открыл рабочий чат до обеда. Сделал себе яичницу. Стал записывать что-то в заметках просто так — не план, не задачи, а как мысли идут." }
];

async function main() {
  console.log("== resetting demo user ==");
  const existing = await prisma.user.findUnique({ where: { telegramId: BigInt(1) } });
  if (existing) await prisma.user.delete({ where: { id: existing.id } });

  console.log("== creating user + book ==");
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt(1),
      firstName: "Демо",
      languageCode: "ru",
      timezone: "Europe/Moscow",
      onboardingDone: true,
      reminderFrequency: "WEEKLY",
      reminderDay: 7,
      reminderTime: "21:00",
      isPaid: true,
      proUntil: new Date(Date.now() + 365 * 86400_000)
    }
  });

  const book = await prisma.book.create({
    data: {
      userId: user.id,
      title: "Книга твоего года",
      shareToken: rand()
    }
  });

  console.log("== generating 5 entries with OpenAI ==");
  const recentForPrompt: Array<{ title: string; quote: string | null; tags: string[]; daysAgo: number }> = [];

  for (let i = 0; i < ENTRIES.length; i += 1) {
    const def = ENTRIES[i]!;
    const createdAt = new Date(Date.now() - def.daysAgo * 86400_000);
    console.log(`  entry ${i + 1}/5 — generating…`);

    const out = await generateEntry({
      rawEntryOrTranscript: def.raw,
      language: detectContentLanguage(def.raw, "ru"),
      recentEntries: recentForPrompt.slice(-6),
      memories: [],
      entryNumber: i + 1
    });

    const accent = pickWeekColor({ mood: out.mood, tags: out.tags, fallbackSeed: out.title }).key;

    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        rawText: def.raw,
        status: "SAVED",
        createdAt,
        updatedAt: createdAt,
        periodStart: new Date(createdAt.getTime() - 6 * 86400_000),
        periodEnd: createdAt
      }
    });

    const page = await prisma.page.create({
      data: {
        userId: user.id,
        entryId: entry.id,
        sceneTitle: out.title,
        sceneContent: out.body,
        quote: out.quote ?? null,
        biographerNote: "",
        mood: out.mood,
        tags: out.tags,
        accentColor: accent,
        shareToken: rand(),
        createdAt,
        updatedAt: createdAt
      }
    });

    recentForPrompt.push({
      title: out.title,
      quote: out.quote ?? null,
      tags: out.tags,
      daysAgo: def.daysAgo
    });

    // Render entry card PNG.
    const buffer = renderEntryCardPng({
      entryNumber: i + 1,
      totalSlots: 52,
      title: out.title,
      body: out.body,
      quote: out.quote ?? null,
      mood: out.mood,
      tags: out.tags,
      createdAt
    });
    await mkdir("./storage/cards", { recursive: true });
    await writeFile(`./storage/cards/entry-${page.id}.png`, buffer);
  }

  console.log("\n== DONE ==");
  console.log(`Book:  http://localhost:3000/book/${book.shareToken}`);
  console.log("\nNow start the bot artifact pipeline by running it once and watching ensureBookArtifacts run.");

  await prisma.$disconnect();
}

function rand(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(20))).toString("base64url");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
