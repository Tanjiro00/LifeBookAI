import "dotenv/config";
import { prisma } from "../apps/bot/src/lib/db.js";
import { reviewAndStoreMemory } from "../apps/bot/src/services/memoryReviewService.js";
import { applyThreadUpdates } from "../apps/bot/src/services/narrativeThreadService.js";
import { selectNarrativeThreads } from "../apps/bot/src/services/context/selectNarrativeThreads.js";
import { generateShareToken } from "../apps/bot/src/services/pageService.js";

// Sprint 3 end-to-end smoke. Drives memory dedupe + narrative thread updates
// against the live Postgres + applied migrations.

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run this smoke script.");
  }

  console.log("[smoke3] creating user…");
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt(920_000_000_000 + Math.floor(Math.random() * 1_000_000)),
      languageCode: "ru",
      firstName: "Smoke3",
      onboardingDone: true
    }
  });
  console.log("[smoke3] user:", user.id);

  // Seed a Page so threads have something to attach events to.
  const entry = await prisma.entry.create({
    data: { userId: user.id, rawText: "seed", finalInputText: "seed", transcriptConfirmed: true, status: "SAVED" }
  });
  const page = await prisma.page.create({
    data: {
      userId: user.id,
      entryId: entry.id,
      sceneTitle: "Тихая среда",
      sceneContent: "Мама достала альбом 1995 года и листала его на кухне.",
      summary: "Тихая сцена с мамой на кухне, альбом 1995.",
      biographerNote: "",
      kind: "WEEKLY",
      shareToken: generateShareToken()
    }
  });

  // ─── Memory dedupe across surface variants ────────────────────────────────
  console.log("\n[smoke3] writing «Бабушка Нина» as PERSON…");
  const r1 = await reviewAndStoreMemory({
    userId: user.id,
    type: "PERSON",
    rawName: "Бабушка Нина",
    evidence: "Бабушка Нина живёт в Калининграде, вяжет варежки и звонит по средам.",
    pageId: page.id,
    language: "ru"
  });
  console.log(`  → ${r1.changeType} memoryId=${r1.memory.id.slice(0, 8)} aliases=${r1.memory.aliases.join(",") || "[]"}`);

  console.log("[smoke3] writing «бабуля Нина» — should MERGE, not duplicate…");
  const r2 = await reviewAndStoreMemory({
    userId: user.id,
    type: "PERSON",
    rawName: "бабуля Нина",
    evidence: "Бабуля рассказывала, что у неё в детстве была собака Мухтар.",
    pageId: page.id,
    language: "ru"
  });
  console.log(`  → ${r2.changeType} memoryId=${r2.memory.id.slice(0, 8)} aliases=${r2.memory.aliases.join(",") || "[]"}`);
  if (r1.memory.id !== r2.memory.id) {
    throw new Error("smoke3: Бабушка/бабуля should have merged into ONE memory");
  }

  console.log("[smoke3] writing «Денис» — should CREATE new memory…");
  const r3 = await reviewAndStoreMemory({
    userId: user.id,
    type: "PERSON",
    rawName: "Денис",
    evidence: "Денис — мой друг с университета, работает в Москве.",
    pageId: page.id,
    language: "ru"
  });
  console.log(`  → ${r3.changeType} memoryId=${r3.memory.id.slice(0, 8)}`);
  if (r3.memory.id === r1.memory.id) {
    throw new Error("smoke3: Денис shouldn't merge with бабушка");
  }

  // Verify revisions row count.
  const revs = await prisma.memoryRevision.findMany({
    where: { memory: { userId: user.id } },
    orderBy: { createdAt: "asc" }
  });
  console.log(`[smoke3] total MemoryRevision rows: ${revs.length}`);
  for (const r of revs) {
    console.log(`  [${r.changeType}] reason=${r.reason} pageId=${r.pageId?.slice(0, 8) ?? "—"}`);
  }

  // ─── Narrative threads ──────────────────────────────────────────────────
  console.log("\n[smoke3] applying thread updates from a planner candidate…");
  const threads1 = await applyThreadUpdates({
    user,
    page: { id: page.id, sceneTitle: page.sceneTitle, sceneContent: page.sceneContent, summary: page.summary },
    candidates: [
      {
        proposedTitle: "Разговоры с бабушкой Ниной",
        proposedType: "RELATIONSHIP",
        updateReason: "First mention of grandmother Nina; introduce as ongoing thread."
      }
    ]
  });
  console.log(`  → created ${threads1.length} thread(s):`, threads1.map((t) => `"${t.title}" status=${t.status}`).join(", "));

  console.log("[smoke3] applying second update on the same thread…");
  const threads2 = await applyThreadUpdates({
    user,
    page: { id: page.id, sceneTitle: page.sceneTitle, sceneContent: page.sceneContent, summary: page.summary },
    candidates: [
      {
        threadId: threads1[0]!.id,
        updateReason: "Nina mentioned dog Мухтар from childhood; new layer of memory shared."
      }
    ]
  });
  console.log(`  → updated ${threads2.length} thread(s); lastMovement="${threads2[0]?.lastMovement}"`);

  // Verify thread events.
  const events = await prisma.narrativeThreadEvent.findMany({
    where: { thread: { userId: user.id } },
    orderBy: { createdAt: "asc" }
  });
  console.log(`[smoke3] thread events: ${events.length}`);

  // ─── Thread retrieval ───────────────────────────────────────────────────
  console.log("\n[smoke3] selectNarrativeThreads for query mentioning «бабушка»…");
  const selected = await selectNarrativeThreads({
    userId: user.id,
    queryText: "Я снова думаю про бабушку и её рассказы про Мухтара.",
    topK: 3
  });
  console.log(`  → selected ${selected.length}:`, selected.map((t) => t.title).join(", "));

  console.log("\n[smoke3] selectNarrativeThreads for unrelated query…");
  const unrelated = await selectNarrativeThreads({
    userId: user.id,
    queryText: "Я выпил кофе и пошёл бегать.",
    topK: 3
  });
  console.log(`  → selected ${unrelated.length}:`, unrelated.map((t) => `${t.title}(score-driven)`).join(", "));

  console.log("\n[smoke3] cleaning up…");
  await prisma.user.delete({ where: { id: user.id } });
  console.log("[smoke3] done.");
}

main()
  .catch((e) => {
    console.error("[smoke3] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
