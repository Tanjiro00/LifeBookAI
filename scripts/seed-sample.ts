import "dotenv/config";
import { getSampleEntryCardPath } from "../apps/bot/src/services/storage.js";

async function main() {
  const path = await getSampleEntryCardPath();
  console.log("Sample entry card written to:", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
