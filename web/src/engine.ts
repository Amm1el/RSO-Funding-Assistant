/**
 * The keyless pipeline running entirely in the browser, for the static/phone build.
 * It reuses the server's own modules (hash embedder, fusion, extractive answerer,
 * citation checks); only the keyword search differs: BM25 over the same stemmed terms,
 * standing in for Postgres full-text search.
 */
import { HashEmbedder } from "../../src/hash-embedder";
import { reciprocalRankFusion } from "../../src/fusion";
import { extractAnswer, terms } from "../../src/extractive";
import { finalizeAnswer } from "../../src/citations";
import type { RetrievedChunk } from "../../src/types";
import data from "./generated/manual-chunks.json";
import type { AskResponse, Health } from "./api";

const TOP_K = 6;
const CANDIDATES = 20;
const embedder = new HashEmbedder();

const chunks: RetrievedChunk[] = data.chunks.map((c, i) => ({ ...c, id: i + 1, similarity: 0 }));
const vectorsReady = embedder.embed(chunks.map((c) => `${c.section}\n${c.content}`));

// BM25 index over the same stemmed terms the extractive answerer uses.
const docTerms = chunks.map((c) => terms(`${c.section} ${c.content}`));
const avgLen = docTerms.reduce((s, t) => s + t.length, 0) / docTerms.length;
const docFreq = new Map<string, number>();
for (const t of docTerms) for (const term of new Set(t)) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);

function bm25(query: string): RetrievedChunk[] {
  const q = new Set(terms(query));
  const n = docTerms.length;
  const scored = docTerms.map((t, i) => {
    let score = 0;
    for (const term of q) {
      const tf = t.filter((x) => x === term).length;
      if (!tf) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (t.length / avgLen)));
    }
    return { chunk: chunks[i], score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, CANDIDATES).map((s) => s.chunk);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

export async function askLocally(question: string): Promise<AskResponse> {
  const vectors = await vectorsReady;
  const [q] = await embedder.embed([question]);
  const byVector = chunks
    .map((c, i) => ({ ...c, similarity: dot(q, vectors[i]) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, CANDIDATES);

  if (!byVector.length || byVector[0].similarity < embedder.minSimilarity) {
    return {
      answerable: false,
      answer: "The Financial Manual doesn't seem to cover that. Please contact SGA Accounting (sgaaccounting@fsu.edu).",
      citations: [],
      passages: [],
      generator: "extractive",
    };
  }
  const similarity = new Map(byVector.map((c) => [c.id, c.similarity]));
  const passages = reciprocalRankFusion([byVector, bm25(question)])
    .slice(0, TOP_K)
    .map(({ item }) => ({ ...item, similarity: similarity.get(item.id) ?? 0 }));
  const answer = finalizeAnswer(extractAnswer(question, passages), passages);
  return { ...answer, passages, generator: "extractive" };
}

export function localHealth(): Health {
  return { ok: true, manual: data.version, chunks: chunks.length, embedder: embedder.name, generator: "extractive" };
}
