import { existsSync } from "node:fs";
import { createPool, migrate } from "../db.js";
import { defaultEmbedder, HashEmbedder, type Embedder } from "../embeddings.js";
import { DEFAULT_CORPUS_DIR, loadCorpus, manualAsDoc } from "../corpus/load.js";
import { ingestCorpus } from "../corpus/ingest.js";

/*
Usage: npm run ingest:corpus [-- --dir data/corpus] [--offline] [--max-words 150 --overlap-words 30]
Ingests the crawled corpus (npm run corpus:pull). Without one, falls back to the local
Financial Manual PDF so the app still works.
*/
const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : DEFAULT_CORPUS_DIR;
const embedder: Embedder = args.includes("--offline") ? new HashEmbedder() : defaultEmbedder();

let docs = await loadCorpus(dir);
if (!docs.length) {
  const manual = "data/26-27SGAFM.pdf";
  if (!existsSync(manual)) throw new Error(`No corpus in ${dir} and no ${manual}. Run npm run corpus:pull first.`);
  console.log(`No crawled corpus in ${dir}; ingesting ${manual} only.`);
  docs = [await manualAsDoc(manual)];
}
const pool = createPool();
await migrate(pool);
const num = (name: string) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : undefined);
await ingestCorpus(pool, docs, embedder, console.log, { maxWords: num("--max-words"), overlapWords: num("--overlap-words") });
await pool.end();
