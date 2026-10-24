import type { DbPool } from "./dbpool.js";
import { keywordSearch, searchChunks } from "./db.js";
import type { Embedder } from "./embeddings.js";
import { finalizeAnswer, type AnswerGenerator } from "./answer.js";
import type { Answer, RetrievedChunk } from "./types.js";
import { reciprocalRankFusion } from "./fusion.js";

export { reciprocalRankFusion };

export interface Deps {
  pool: DbPool;
  /** Embeds questions; its name also selects which stored corpus to search. */
  embedder: Embedder;
  generator: AnswerGenerator;
}

export interface AskOptions {
  /** Limit the search to one app section, e.g. "funding". */
  collection?: string | null;
}

export type RetrievalMode = "hybrid" | "vector";

export const TOP_K = 6;
/** How many candidates each search contributes before fusion. */
const CANDIDATES = 20;
/**
 * Finds the manual passages most relevant to a question.
 *
 * 1. Vector search finds passages with similar meaning.
 * 2. If even the best one is below the embedder's cutoff, the question is off-topic: return nothing.
 * 3. In hybrid mode, full-text search finds passages with the same exact terms ("EIN", "$225"),
 *    and the two rankings are merged with reciprocal rank fusion.
 */
export async function retrieve(
  deps: Pick<Deps, "pool" | "embedder">,
  question: string,
  k = TOP_K,
  mode: RetrievalMode = "hybrid",
  opts: AskOptions = {},
): Promise<RetrievedChunk[]> {
  const scope = { embedder: deps.embedder.name, collection: opts.collection ?? null };
  const [embedding] = await deps.embedder.embed([question]);
  const byVector = await searchChunks(deps.pool, scope, embedding, CANDIDATES);
  if (!byVector.length || byVector[0].similarity < deps.embedder.minSimilarity) return [];
  if (mode === "vector") return byVector.slice(0, k);

  const byKeyword = await keywordSearch(deps.pool, scope, question, CANDIDATES);
  const similarity = new Map(byVector.map((c) => [c.id, c.similarity]));
  return reciprocalRankFusion([byVector, byKeyword])
    .slice(0, k)
    .map(({ item }) => ({ ...item, similarity: similarity.get(item.id) ?? 0 }));
}

export interface AskResult extends Answer {
  /** Number of passages given to the generator. */
  retrieved: number;
  /** Which generator wrote the answer, so the UI can label extractive answers. */
  generator: string;
  /** The passages the answer was based on, in ranked order. */
  passages: RetrievedChunk[];
}

/** Retrieve, then answer. Skips the generator entirely when nothing relevant is found. */
export async function ask(deps: Deps, question: string, opts: AskOptions = {}): Promise<AskResult> {
  const chunks = await retrieve(deps, question, TOP_K, "hybrid", opts);
  if (chunks.length === 0) {
    return {
      answerable: false,
      answer: "SGA's published sources don't seem to cover that. For funding questions, contact SGA Accounting (sgaaccounting@fsu.edu).",
      citations: [],
      retrieved: 0,
      generator: deps.generator.name,
      passages: [],
    };
  }
  const raw = await deps.generator.generate(question, chunks);
  return { ...finalizeAnswer(raw, chunks), retrieved: chunks.length, generator: deps.generator.name, passages: chunks };
}
