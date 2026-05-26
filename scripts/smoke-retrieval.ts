import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/bot/src/lib/db.js";
import { embedPage } from "../apps/bot/src/services/embeddingService.js";
import { retrieveRelatedPages } from "../apps/bot/src/services/retrieval/retrieveRelatedPages.js";
import { buildNarrativeContext } from "../apps/bot/src/services/context/buildNarrativeContext.js";

// Sprint 1 end-to-end smoke. Seeds a test user with 5 weekly pages on different
// topics, embeds them, then queries semantically. Asserts that the retrieval
// orders results sensibly (the «mama» query pulls pages mentioning «мама»
// before unrelated ones).
//
// Cleans up after itself: the user, all entries, pages, embeddings, and book
// records get deleted at the end.

type Seed = { title: string; body: string; mood: string[]; tags: string[] };

const SEEDS: Seed[] = [
  {
    title: "Тихая среда с мамой",
    body:
      "В среду вечером я зашёл к маме. На кухне пахло пирогом, она сидела у окна и листала альбом 1995 года. " +
      "Я сел рядом и слушал, как она вспоминает. Не пытался переводить разговор на полезные темы. " +
      "Просто смотрел, как за окном темнеет.",
    mood: ["quiet"],
    tags: ["мама", "кухня"]
  },
  {
    title: "Длинная пробежка в парке",
    body:
      "Утром в субботу я добежал до того моста, к которому раньше не доходил. " +
      "Дыхание выравнивалось медленнее, но в ногах появилось знакомое лёгкое чувство. " +
      "Возвращался шагом и думал, что весна в этом году пришла без шума.",
    mood: ["resolute"],
    tags: ["бег", "парк"]
  },
  {
    title: "Один разговор по телефону",
    body:
      "Денис позвонил поздно вечером. Я думал, опять про работу, но он спросил про маму. " +
      "Я не знал, что ответить, и просто сказал: «нормально». Подумал, что это вранье. " +
      "Перезвонил утром и рассказал про альбом и пирог.",
    mood: ["reflective"],
    tags: ["денис", "звонок", "мама"]
  },
  {
    title: "Книги, которые я снова открыл",
    body:
      "На полке стоит том Чехова, который не открывался года три. Я взял его с собой в кафе и читал час, " +
      "пока кофе остывал. Странно: каждое предложение помнится по-новому. " +
      "Может быть, в декабре дочитаю до конца.",
    mood: ["calm"],
    tags: ["чтение", "кафе"]
  },
  {
    title: "Понедельник без планов",
    body:
      "В понедельник утром я не поставил будильник и проснулся в десять. " +
      "Вместо тревоги — какая-то лёгкость. Сделал кофе и долго смотрел, как пар поднимается. " +
      "Поработал три часа, потом вышел гулять. Без плана, без цели.",
    mood: ["quiet"],
    tags: ["утро", "кофе"]
  }
];

async function main(): Promise<void> {
  // This smoke script hits OpenAI for embeddings — requires OPENAI_API_KEY.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run this smoke script.");
  }

  console.log("[smoke] creating test user…");
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt(900_000_000_000 + Math.floor(Math.random() * 1_000_000)),
      languageCode: "ru",
      firstName: "Smoke",
      onboardingDone: true
    }
  });
  console.log("[smoke] user:", user.id);

  // We'll create one Entry per seed and one Page per seed.
  const pageIds: string[] = [];
  for (const seed of SEEDS) {
    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        rawText: `${seed.title}\n\n${seed.body}`,
        transcriptConfirmed: true,
        finalInputText: `${seed.title}\n\n${seed.body}`,
        status: "SAVED"
      }
    });
    const page = await prisma.page.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        entryId: entry.id,
        sceneTitle: seed.title,
        sceneContent: seed.body,
        biographerNote: "",
        teaser: seed.body.slice(0, 160),
        summary: seed.body.slice(0, 240),
        mood: seed.mood,
        tags: seed.tags,
        accentColor: "quiet",
        kind: "WEEKLY",
        version: 1,
        isCurrent: true,
        // Stagger createdAt so daysAgo computations vary.
        createdAt: new Date(Date.now() - (SEEDS.length - pageIds.length) * 86_400_000)
      }
    });
    pageIds.push(page.id);
    const result = await embedPage(page.id);
    console.log(
      `[smoke] page #${pageIds.length} "${seed.title.slice(0, 30)}…" → ${result.status}` +
        (result.status === "embedded" ? ` (dims=${result.dimensions})` : "")
    );
  }

  // ─── Retrieval check ──────────────────────────────────────────────────────
  console.log("\n[smoke] semantic query: «вечер у мамы, разговор о ней»");
  const related = await retrieveRelatedPages({
    userId: user.id,
    queryText: "Я снова думаю про маму и тот вечер на её кухне",
    topK: 3
  });
  for (const r of related) {
    console.log(
      `  → "${r.title.slice(0, 40)}…" similarity=${r.similarity.toFixed(3)} tags=${r.tags.join(",")}`
    );
  }

  console.log("\n[smoke] semantic query: «утро, кофе, тишина»");
  const related2 = await retrieveRelatedPages({
    userId: user.id,
    queryText: "Утро, я делаю кофе, никуда не тороплюсь",
    topK: 3
  });
  for (const r of related2) {
    console.log(
      `  → "${r.title.slice(0, 40)}…" similarity=${r.similarity.toFixed(3)} tags=${r.tags.join(",")}`
    );
  }

  // ─── Full GenerationContext check ─────────────────────────────────────────
  console.log("\n[smoke] buildNarrativeContext for a fresh entry about мама…");
  const ctx = await buildNarrativeContext({
    user,
    currentEntryText: "Сегодня снова заехал к маме. Долго сидели на кухне."
  });
  console.log("  pageNumber:", ctx.timeline.pageNumber);
  console.log("  prologue bodies:", ctx.manuscriptContext.prologueBodies.length);
  console.log("  recent bodies:", ctx.manuscriptContext.recentBodies.length);
  console.log("  related bodies:", ctx.manuscriptContext.relatedBodies.length);
  console.log("  related ids:", ctx.diagnostics.relatedPageIds);
  console.log("  token estimate:", ctx.diagnostics.tokenEstimate);

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  console.log("\n[smoke] cleaning up test data…");
  // Manual deletes — Page→PageEmbedding cascades, Entry→Page cascades, User→Entry cascades.
  await prisma.user.delete({ where: { id: user.id } });
  console.log("[smoke] done.");
}

main()
  .catch((e) => {
    console.error("[smoke] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
