import { createPool } from "../db.js";
import { defaultEmbedder, HashEmbedder, type Embedder } from "../embeddings.js";
import { DEFAULT_MAX_WORDS, DEFAULT_OVERLAP_WORDS } from "../ingest/chunk.js";
import { ingestManual } from "../ingest/run.js";

// Usage: npm run ingest -- data/26-27SGAFM.pdf [--version 2026-27] [--offline] [--max-words 150] [--overlap 30]
// Uses OpenAI embeddings when USE_AI=true and OPENAI_API_KEY is set; otherwise (or with --offline)
// the local hash embedder.
const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const valueFlags = new Set(["--version", "--max-words", "--overlap"]);
const file = args.find((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1])) ?? "data/26-27SGAFM.pdf";
const embedder: Embedder = args.includes("--offline") ? new HashEmbedder() : defaultEmbedder();

const pool = createPool();
await ingestManual(pool, file, embedder, {
  version: flag("--version"),
  maxWords: Number(flag("--max-words") ?? DEFAULT_MAX_WORDS),
  overlapWords: Number(flag("--overlap") ?? DEFAULT_OVERLAP_WORDS),
});
await pool.end();
