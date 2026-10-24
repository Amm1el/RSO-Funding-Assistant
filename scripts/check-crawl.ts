// Guards the weekly crawl: compares a fresh crawl's manifest with the one on the
// corpus-data branch and fails if any source shrank by more than half (the site was down,
// blocked the runner, or changed its layout). Better to keep last week's corpus than
// publish a broken one.
// Usage: npx tsx scripts/check-crawl.ts corpus/manifest.json [previous-manifest.json]
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

type Manifest = { crawledAt: string; counts: Record<string, { documents: number }> };
const [freshPath, prevPath] = process.argv.slice(2);
const fresh: Manifest = JSON.parse(await readFile(freshPath, "utf8"));
if (!prevPath || !existsSync(prevPath)) {
  console.log("No previous manifest to compare with; publishing.");
  process.exit(0);
}
const prev: Manifest = JSON.parse(await readFile(prevPath, "utf8"));
const problems: string[] = [];
for (const [source, { documents }] of Object.entries(prev.counts)) {
  const now = fresh.counts[source]?.documents ?? 0;
  const line = `${source}: ${documents} -> ${now} documents`;
  console.log(line);
  if (now < documents * 0.5) problems.push(line);
}
if (problems.length) {
  console.error(`::error::Crawl shrank by more than half, not publishing: ${problems.join("; ")}`);
  process.exit(1);
}
