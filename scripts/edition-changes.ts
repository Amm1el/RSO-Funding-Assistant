// What changed between editions of the same document (e.g. the manual and its 9/21/26
// update), from the crawled corpus. Prints markdown; the crawl workflow adds it to the run summary.
// Usage: npx tsx scripts/edition-changes.ts [--dir data/corpus]
import { DEFAULT_CORPUS_DIR, loadCorpus } from "../src/corpus/load.js";
import { changesMarkdown, editionChanges } from "../src/corpus/editions.js";

const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : DEFAULT_CORPUS_DIR;
const changes = editionChanges((await loadCorpus(dir)).filter((d) => d.kind === "document"));
console.log(`## What changed between editions (${changes.length} documents)\n`);
console.log(changesMarkdown(changes));
