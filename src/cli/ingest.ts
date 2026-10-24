import { createPool } from "../db.js";
import { defaultEmbedder, HashEmbedder, type Embedder } from "../embeddings.js";
import { ingestManual } from "../ingest/run.js";

// Usage: npm run ingest -- data/26-27SGAFM.pdf [--offline]
// Ingests only the Financial Manual. For everything SGA publishes, use npm run ingest:corpus.
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? "data/26-27SGAFM.pdf";
const embedder: Embedder = args.includes("--offline") ? new HashEmbedder() : defaultEmbedder();
const pool = createPool();
await ingestManual(pool, file, embedder);
await pool.end();
