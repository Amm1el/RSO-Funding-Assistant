import type { DbPool } from "../db.js";
import type { Embedder } from "../embeddings.js";
import { manualAsDoc } from "../corpus/load.js";
import { ingestCorpus } from "../corpus/ingest.js";

/** Ingests just the local Financial Manual PDF (the app's original single-document mode). */
export async function ingestManual(pool: DbPool, file: string, embedder: Embedder, options: { log?: (m: string) => void } = {}) {
  const { migrate } = await import("../db.js");
  await migrate(pool);
  const summary = await ingestCorpus(pool, [await manualAsDoc(file)], embedder, options.log);
  return { chunks: summary.chunks };
}
