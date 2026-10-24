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
  /** Filled lazily: a chunk is embedded the first time a question shares a word with it. */
  vectors: (Float32Array | undefined)[];
  /** term -> indexes of the chunks containing it. */
  postings: Map<string, number[]>;
  docTerms: Map<string, number>[];
  lengths: number[];
  avgLen: number;
  docFreq: Map<string, number>;
}

async function decode(): Promise<Payload> {
  if (!CORPUS_GZ_BASE64) throw new Error("This build has no sources packed in. Build it with `npm run build:static`.");
  // The browser's own base64 decoder (via a data: URL) is ~10x faster than atob + charCodeAt.
  const body = (await fetch(`data:application/octet-stream;base64,${CORPUS_GZ_BASE64}`)).body!;
  const stream = body.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

let payloadPromise: Promise<Payload> | undefined;
const payloadFn = () => (payloadPromise ??= decode());

let indexPromise: Promise<Index> | undefined;
/**
 * Builds the search index on the first question, not on page load: the Directory and the
 * section list only need the payload. Vectors aren't computed up front at all (that was
 * most of the ~5 s first load); see candidates().
 */
function index(): Promise<Index> {
  return (indexPromise ??= (async () => {
    const payload = await payloadFn();
    const chunks: RetrievedChunk[] = payload.chunks.map(([collection, title, section, pageStart, pageEnd, url, content, weight], i) => ({
      id: i + 1, ordinal: i, collection, title, section, pageStart, pageEnd, url, content, weight: weight ?? 1, similarity: 0,
    }));
    const docTerms = chunks.map((c) => {
      const tf = new Map<string, number>();
      for (const t of terms(`${c.title} ${c.section} ${c.content}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
      return tf;
    });
    const lengths = docTerms.map((tf) => [...tf.values()].reduce((s, n) => s + n, 0));
    const postings = new Map<string, number[]>();
    docTerms.forEach((tf, i) => {
      for (const t of tf.keys()) {
        const list = postings.get(t);
        if (list) list.push(i);
        else postings.set(t, [i]);
      }
    });
    const docFreq = new Map([...postings].map(([t, list]) => [t, list.length]));
    return { payload, chunks, vectors: new Array(chunks.length), postings, docTerms, lengths, avgLen: lengths.reduce((s, n) => s + n, 0) / lengths.length, docFreq };
  })());
}

/** Chunks that share at least one word with the question (in the allowed section). */
function candidates(ix: Index, query: string, allowed: (c: RetrievedChunk) => boolean): number[] {
  const seen = new Set<number>();
  for (const t of new Set(terms(query))) for (const i of ix.postings.get(t) ?? []) if (allowed(ix.chunks[i])) seen.add(i);
  return [...seen];
}

/** How many keyword matches the vector search re-scores (see askLocally). */
const VECTOR_POOL = Number((globalThis as { VECTOR_POOL?: number }).VECTOR_POOL ?? 400);

function bm25(ix: Index, query: string, ids: number[], limit = CANDIDATES): RetrievedChunk[] {
  const q = new Set(terms(query));
  const n = ix.chunks.length;
  const scored: { chunk: RetrievedChunk; score: number }[] = [];
  ids.forEach((i) => {
    const tf = ix.docTerms[i];
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
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.chunk);
}

export async function askLocally(question: string, collection: string | null = null): Promise<AskResponse> {
  const ix = await index();
  const allowed = (c: RetrievedChunk) => !collection || c.collection === collection;
  // Vector search over the chunks sharing a word with the question: with the hashed
  // bag-of-words embedder, a chunk sharing none scores ~0 anyway. Embed them on first use.
  const shared = candidates(ix, question, allowed);
  // Common words ("year", "fund") appear in thousands of chunks; embedding all of them made
  // the first question slow. Vector search re-scores the best keyword matches instead.
  const keyword = bm25(ix, question, shared, Math.max(VECTOR_POOL, CANDIDATES));
  const ids = keyword.map((c) => c.id - 1);
  const missing = ids.filter((i) => !ix.vectors[i]);
  if (missing.length) {
    const raw = await embedder.embed(missing.map((i) => `${ix.chunks[i].title}\n${ix.chunks[i].section}\n${ix.chunks[i].content}`));
    missing.forEach((i, j) => (ix.vectors[i] = Float32Array.from(raw[j])));
  }
  const [q] = await embedder.embed([question]);
  const qv = Float32Array.from(q);
  const byVector: RetrievedChunk[] = [];
  ids.forEach((i) => {
    const c = ix.chunks[i];
    const v = ix.vectors[i]!;
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
  const passages = weightedFusion([top, keyword.slice(0, CANDIDATES)])
    .slice(0, TOP_K)
    .map(({ item }) => ({ ...item, similarity: similarity.get(item.id) ?? 0 }));
  const answer = finalizeAnswer(extractAnswer(question, passages), passages);
  return { ...answer, passages, generator: "extractive" };
}

export async function localHealth(): Promise<Health> {
  const p = await payloadFn();
  // The page is usable now; build the search index in the background so it's usually
  // ready before the first question is typed.
  setTimeout(() => void index(), 100);
  return { ok: true, sources: p.sources, chunks: p.chunks.length, updatedAt: p.updatedAt, embedder: embedder.name, generator: "extractive" };
}

export async function localCollections(): Promise<Collection[]> {
  return (await payloadFn()).collections;
}

export async function localDirectory(): Promise<Directory> {
  return (await payloadFn()).directory;
}
