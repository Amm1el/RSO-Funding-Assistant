import type { DbPool } from "./dbpool.js";
import { keywordSearch, searchChunks } from "./db.js";
import type { Embedder } from "./embeddings.js";
import { finalizeAnswer, type AnswerGenerator } from "./answer.js";
import type { Answer, RetrievedChunk } from "./types.js";

export interface Deps {
  pool: DbPool;
  /** The ingested manual to answer from. */
  documentId: number;
  embedder: Embedder;
  generator: AnswerGenerator;
}

export type RetrievalMode = "hybrid" | "vector";

export const TOP_K = 6;
/** How many candidates each search contributes before fusion. */
const CANDIDATES = 20;
/** Standard RRF constant: dampens the gap between rank 1 and rank 2. */
const RRF_K = 60;

/**
 * Reciprocal rank fusion: each list votes 1 / (60 + rank) for each item. It combines
 * rankings without needing their scores to be on the same scale, which vector similarity
 * and full-text rank are not.
 */
export function reciprocalRankFusion<T extends { id: number }>(lists: T[][], k = RRF_K): { item: T; score: number }[] {
  const scores = new Map<number, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const entry = scores.get(item.id) ?? { item, score: 0 };
      entry.score += 1 / (k + rank + 1);
      scores.set(item.id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

/**
 * Finds the manual passages most relevant to a question.
 *
 * 1. Vector search finds passages with similar meaning.
 * 2. If even the best one is below the embedder's cutoff, the question is off-topic: return nothing.
 * 3. In hybrid mode, full-text search finds passages with the same exact terms ("EIN", "$225"),
 *    and the two rankings are merged with reciprocal rank fusion.
 */
export async function retrieve(
  deps: Pick<Deps, "pool" | "embedder" | "documentId">,
  question: string,
  k = TOP_K,
  mode: RetrievalMode = "hybrid",
): Promise<RetrievedChunk[]> {
  const [embedding] = await deps.embedder.embed([question]);
  const byVector = await searchChunks(deps.pool, deps.documentId, embedding, CANDIDATES);
  if (!byVector.length || byVector[0].similarity < deps.embedder.minSimilarity) return [];
  if (mode === "vector") return byVector.slice(0, k);

  const byKeyword = await keywordSearch(deps.pool, deps.documentId, question, CANDIDATES);
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
export async function ask(deps: Deps, question: string): Promise<AskResult> {
  const chunks = await retrieve(deps, question);
  if (chunks.length === 0) {
    return {
      answerable: false,
      answer: "The Financial Manual doesn't seem to cover that. Please contact SGA Accounting (sgaaccounting@fsu.edu).",
      citations: [],
      retrieved: 0,
      generator: deps.generator.name,
      passages: [],
    };
  }
  const raw = await deps.generator.generate(question, chunks);
  return { ...finalizeAnswer(raw, chunks), retrieved: chunks.length, generator: deps.generator.name, passages: chunks };
}
