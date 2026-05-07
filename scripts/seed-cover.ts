import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { ensureBookArtifacts } from "../apps/bot/src/services/bookComposer.js";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(1) } });
  if (!user) throw new Error("demo user not found");
  console.log("running ensureBookArtifacts for", user.id);
  await ensureBookArtifacts(user.id);
  const book = await prisma.book.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  console.log({ aiTitle: book?.aiTitle, coverUrl: book?.coverUrl });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
