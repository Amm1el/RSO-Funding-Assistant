/**
 * The keyless pipeline running entirely in the browser, for the static/phone build.
 * It reuses the server's own modules (hash embedder, fusion, extractive answerer,
 * citation checks); only the keyword search differs: BM25 over the same stemmed terms,
 * standing in for Postgres full-text search. The corpus ships gzipped inside the page.
 */
import { HashEmbedder } from "../../src/hash-embedder";
import { weightedFusion } from "../../src/fusion";
import { extractAnswer, terms } from "../../src/extractive";
import { finalizeAnswer } from "../../src/citations";
import type { RetrievedChunk } from "../../src/types";
import { CORPUS_GZ_BASE64 } from "./generated/corpus-data";
import type { AskResponse, Collection, Directory, Health } from "./api";

const TOP_K = 6;
/** BM25 parameters; the server uses the same (src/db.ts). */
const K1 = 1.2;
const B = 0.75;
const CANDIDATES = 40;
const embedder = new HashEmbedder();

interface Payload {
  sources: number;
  updatedAt: string;
  collections: Collection[];
  chunks: [string, string, string, number, number, string, string, number][];
  directory: Directory;
}

interface Index {
  payload: Payload;
  chunks: RetrievedChunk[];
  vectors: Float32Array[];
  docTerms: Map<string, number>[];
  lengths: number[];
  avgLen: number;
  docFreq: Map<string, number>;
}

async function decode(): Promise<Payload> {
  const bytes = Uint8Array.from(atob(CORPUS_GZ_BASE64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

let indexPromise: Promise<Index> | undefined;
function index(): Promise<Index> {
  return (indexPromise ??= (async () => {
    const payload = await decode();
    const chunks: RetrievedChunk[] = payload.chunks.map(([collection, title, section, pageStart, pageEnd, url, content, weight], i) => ({
      id: i + 1, ordinal: i, collection, title, section, pageStart, pageEnd, url, content, weight: weight ?? 1, similarity: 0,
    }));
    const raw = await embedder.embed(chunks.map((c) => `${c.title}\n${c.section}\n${c.content}`));
    const vectors = raw.map((v) => Float32Array.from(v));
    const docTerms = chunks.map((c) => {
      const tf = new Map<string, number>();
      for (const t of terms(`${c.title} ${c.section} ${c.content}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
      return tf;
    });
    const lengths = docTerms.map((tf) => [...tf.values()].reduce((s, n) => s + n, 0));
    const docFreq = new Map<string, number>();
    for (const tf of docTerms) for (const t of tf.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    return { payload, chunks, vectors, docTerms, lengths, avgLen: lengths.reduce((s, n) => s + n, 0) / lengths.length, docFreq };
  })());
}

function bm25(ix: Index, query: string, allowed: (c: RetrievedChunk) => boolean): RetrievedChunk[] {
  const q = new Set(terms(query));
  const n = ix.chunks.length;
  const scored: { chunk: RetrievedChunk; score: number }[] = [];
  ix.docTerms.forEach((tf, i) => {
    if (!allowed(ix.chunks[i])) return;
    let score = 0;
    for (const term of q) {
      const f = tf.get(term);
      if (!f) continue;
      const df = ix.docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + B * (ix.lengths[i] / ix.avgLen)));
    }
    if (score > 0) scored.push({ chunk: ix.chunks[i], score });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, CANDIDATES).map((s) => s.chunk);
}

export async function askLocally(question: string, collection: string | null = null): Promise<AskResponse> {
  const ix = await index();
  const allowed = (c: RetrievedChunk) => !collection || c.collection === collection;
  const [q] = await embedder.embed([question]);
  const qv = Float32Array.from(q);
  const byVector: RetrievedChunk[] = [];
  ix.vectors.forEach((v, i) => {
    const c = ix.chunks[i];
    if (!allowed(c)) return;
    let dot = 0;
    for (let j = 0; j < v.length; j++) dot += v[j] * qv[j];
    byVector.push({ ...c, similarity: dot });
  });
  byVector.sort((a, b) => b.similarity - a.similarity);
  const top = byVector.slice(0, CANDIDATES);

  if (!top.length || top[0].similarity < embedder.minSimilarity) {
    return {
      answerable: false,
      answer: "SGA's published sources don't seem to cover that. For funding questions, contact SGA Accounting (sgaaccounting@fsu.edu).",
      citations: [],
      passages: [],
      generator: "extractive",
    };
  }
  const similarity = new Map(top.map((c) => [c.id, c.similarity]));
  const passages = weightedFusion([top, bm25(ix, question, allowed)])
    .slice(0, TOP_K)
    .map(({ item }) => ({ ...item, similarity: similarity.get(item.id) ?? 0 }));
  const answer = finalizeAnswer(extractAnswer(question, passages), passages);
  return { ...answer, passages, generator: "extractive" };
}

export async function localHealth(): Promise<Health> {
  const { payload, chunks } = await index();
  return { ok: true, sources: payload.sources, chunks: chunks.length, updatedAt: payload.updatedAt, embedder: embedder.name, generator: "extractive" };
}

export async function localCollections(): Promise<Collection[]> {
  return (await index()).payload.collections;
}

export async function localDirectory(): Promise<Directory> {
  return (await index()).payload.directory;
}
