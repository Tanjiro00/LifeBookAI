import "dotenv/config";
import { prisma } from "../apps/bot/src/lib/db.js";
import { embedPage } from "../apps/bot/src/services/embeddingService.js";

// Sprint 1.3 — Backfill embeddings for existing pages.
//
// Usage:
//   npx tsx scripts/backfill-embeddings.ts
//   npx tsx scripts/backfill-embeddings.ts --max-jobs-per-min=120
//   npx tsx scripts/backfill-embeddings.ts --user=<userId>
//
// Why a script and not just letting the queue catch up:
//   - On day-1 of Sprint 1 deploy there are zero embeddings; users get poor
//     retrieval until every page is embedded.
//   - The queue would fire only on next page create — so old pages never
//     get embedded for users who don't write.
//   - The script is resumable: embedPage() short-circuits when bodyHash
//     matches, so repeated runs only process new/changed pages.
//
// Cost: 1k pages × ~500 tokens × $0.02/1M tokens ≈ $0.01. Safe to run blindly.

type Args = {
  maxJobsPerMin: number;
  userId?: string;
};

function parseArgs(): Args {
  const args: Args = { maxJobsPerMin: 120 };
  for (const raw of process.argv.slice(2)) {
    const [key, val] = raw.split("=");
    if (key === "--max-jobs-per-min") args.maxJobsPerMin = Math.max(1, Number(val));
    if (key === "--user") args.userId = val;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const minIntervalMs = Math.ceil(60_000 / args.maxJobsPerMin);

  const pages = await prisma.page.findMany({
    where: {
      isCurrent: true,
      ...(args.userId ? { userId: args.userId } : {})
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true }
  });
  console.log(
    `[backfill] ${pages.length} pages to consider${args.userId ? ` (user ${args.userId})` : ""}; rate ≤${args.maxJobsPerMin}/min`
  );

  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  let lastTickAt = 0;

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]!;
    const elapsed = Date.now() - lastTickAt;
    if (elapsed < minIntervalMs) {
      await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
    }
    lastTickAt = Date.now();
    try {
      const result = await embedPage(page.id);
      if (result.status === "embedded") embedded += 1;
      else skipped += 1;
      if ((i + 1) % 25 === 0 || i === pages.length - 1) {
        console.log(`[backfill] ${i + 1}/${pages.length} processed (embedded=${embedded}, skipped=${skipped}, failed=${failed})`);
      }
    } catch (err) {
      failed += 1;
      console.error(`[backfill] page ${page.id} failed:`, (err as Error).message);
    }
  }

  console.log(`[backfill] done — embedded=${embedded}, skipped=${skipped}, failed=${failed}`);
}

main()
  .catch((e) => {
    console.error("[backfill] fatal:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
