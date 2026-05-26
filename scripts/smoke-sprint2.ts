import "dotenv/config";
import { prisma } from "../apps/bot/src/lib/db.js";
import {
  createPageForEntry,
  generateShareToken
} from "../apps/bot/src/services/pageService.js";
import {
  reviseExistingPage,
  rewritePageTitle
} from "../apps/bot/src/services/pageRevisionService.js";

// Sprint 2 end-to-end smoke. Drives the full plan→write→validate→persist path
// against a live Postgres + pgvector, using mock AI throughout. Then exercises
// the revise + retitle flow and asserts versioning is consistent.

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run this smoke script.");
  }

  console.log("[smoke2] creating user…");
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt(910_000_000_000 + Math.floor(Math.random() * 1_000_000)),
      languageCode: "ru",
      firstName: "Smoke2",
      onboardingDone: true,
      writingStyle: "Calm, restrained, concrete details"
    }
  });
  console.log("[smoke2] user:", user.id);

  // Seed a Book so book share-token logic in pageService doesn't 404.
  await prisma.book.create({
    data: {
      userId: user.id,
      title: "Smoke 2 Book",
      shareToken: generateShareToken()
    }
  });

  // Create three entries via the full pipeline.
  const seeds = [
    "В понедельник утром я долго сидел на кухне и пил кофе. Снег лежал на крышах. Я ни о чём не думал.",
    "Во вторник позвонил Денис. Спросил про маму. Я не нашёл что ответить, потом перезвонил утром.",
    "В среду снова заварил кофе. Утро тихое. Я подумал, что эти зимние утра становятся ритуалом."
  ];
  const pages: { id: string; version: number; title: string }[] = [];
  for (const seed of seeds) {
    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        rawText: seed,
        transcriptConfirmed: true,
        finalInputText: seed,
        status: "COLLECTED"
      }
    });
    const page = await createPageForEntry(user, entry);
    pages.push({ id: page.id, version: page.version, title: page.sceneTitle });
    console.log(
      `[smoke2] page v${page.version} created: "${page.sceneTitle}" (id=${page.id.slice(0, 8)})`
    );
    // Inspect what got persisted.
    const fresh = await prisma.page.findUniqueOrThrow({
      where: { id: page.id },
      select: { generationPlan: true, sourceContext: true, teaser: true, summary: true }
    });
    const plan = fresh.generationPlan as { pageRole?: string } | null;
    const ctx = fresh.sourceContext as { relatedPageIds?: string[]; validation?: { ok?: boolean; errors?: string[]; repaired?: boolean } } | null;
    console.log(
      `         plan.pageRole=${plan?.pageRole} | related=${ctx?.relatedPageIds?.length ?? 0} | validation.ok=${ctx?.validation?.ok} | repaired=${ctx?.validation?.repaired}`
    );
  }

  // ─── Revision ──────────────────────────────────────────────────────────────
  const target = pages[0]!;
  console.log(`\n[smoke2] revising page v${target.version} ("${target.title}")…`);
  const revised = await reviseExistingPage({
    user,
    pageId: target.id,
    userInstruction: "Замени второй абзац: я был не уставшим, а спокойным."
  });
  console.log(
    `[smoke2] revised → new id=${revised.id.slice(0, 8)} version=${revised.version} revisionOf=${revised.revisionOfId?.slice(0, 8)}`
  );

  // Check versioning integrity: original is no longer current; revised is.
  const allVersions = await prisma.page.findMany({
    where: { OR: [{ id: target.id }, { revisionOfId: target.id }] },
    select: { id: true, version: true, isCurrent: true }
  });
  console.log(`[smoke2] chain: ${allVersions.map((p) => `v${p.version}${p.isCurrent ? "*" : ""}`).join(" → ")} (* = current)`);
  const currentCount = allVersions.filter((p) => p.isCurrent).length;
  if (currentCount !== 1) {
    throw new Error(`smoke2: expected exactly 1 current version in chain, got ${currentCount}`);
  }

  // ─── Title rewrite ─────────────────────────────────────────────────────────
  console.log(`\n[smoke2] rewriting title of v${revised.version}…`);
  const retitled = await rewritePageTitle({
    user,
    pageId: revised.id,
    userInstruction: "Сделай заголовок проще, одним словом если получится."
  });
  console.log(`[smoke2] retitled → v${retitled.version} "${retitled.sceneTitle}"`);

  // Verify chain has 3 versions now: v1 (revisionOf=null), v2 (revisionOf=v1), v3 (revisionOf=v2).
  const fullChain = await prisma.page.findMany({
    where: { OR: [{ id: target.id }, { revisionOfId: target.id }, { revisionOfId: revised.id }] },
    orderBy: { version: "asc" },
    select: { id: true, version: true, isCurrent: true, revisionOfId: true, sceneTitle: true }
  });
  console.log("[smoke2] full chain:");
  for (const p of fullChain) {
    console.log(
      `  v${p.version} ${p.isCurrent ? "[CURRENT]" : "         "} title="${p.sceneTitle}" revisionOf=${p.revisionOfId?.slice(0, 8) ?? "—"}`
    );
  }
  if (fullChain.filter((p) => p.isCurrent).length !== 1) {
    throw new Error("smoke2: chain integrity broken — multiple isCurrent=true");
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  console.log("\n[smoke2] cleaning up…");
  await prisma.user.delete({ where: { id: user.id } });
  console.log("[smoke2] done.");
}

main()
  .catch((e) => {
    console.error("[smoke2] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
