import type pg from "pg";
import { searchChunks } from "./db.js";
import type { Embedder } from "./embeddings.js";
import { finalizeAnswer, type AnswerGenerator } from "./answer.js";
import type { Answer, RetrievedChunk } from "./types.js";

export interface Deps {
  pool: pg.Pool;
  embedder: Embedder;
  generator: AnswerGenerator;
}

export const TOP_K = 6;
/** Below this cosine similarity, retrieved text is treated as unrelated. Tune with the eval set. */
export const MIN_SIMILARITY = 0.25;

export async function retrieve(deps: Pick<Deps, "pool" | "embedder">, question: string, k = TOP_K): Promise<RetrievedChunk[]> {
  const [embedding] = await deps.embedder.embed([question]);
  const results = await searchChunks(deps.pool, embedding, k);
  return results.filter((r) => r.similarity >= MIN_SIMILARITY);
}

/** Retrieve, then answer. Skips the model call entirely when nothing relevant is found. */
export async function ask(deps: Deps, question: string): Promise<Answer & { retrieved: number }> {
  const chunks = await retrieve(deps, question);
  if (chunks.length === 0) {
    return {
      answerable: false,
      answer: "The Financial Manual doesn't seem to cover that. Please contact SGA directly.",
      citations: [],
      retrieved: 0,
    };
  }
  const raw = await deps.generator.generate(question, chunks);
  return { ...finalizeAnswer(raw, chunks), retrieved: chunks.length };
}
