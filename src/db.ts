import { readFile } from "node:fs/promises";
import { toSql } from "pgvector";
import { config } from "./config.js";
import { createDbPool, type DbPool, type Queryable } from "./dbpool.js";
import type { Chunk, RetrievedChunk } from "./types.js";
import { terms } from "./terms.js";

/** Term frequencies for BM25, from the same tokenizer the embedder and phone build use. */
export function termFrequencies(text: string): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of terms(text)) if (t.length <= 60) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

export type { DbPool } from "./dbpool.js";

export function createPool(connectionString = config.DATABASE_URL): DbPool {
  return createDbPool(connectionString);
}

export async function migrate(pool: DbPool): Promise<void> {
  const sql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

export interface DocumentInput {
  title: string;
  /** For local files; crawled sources use fetchedAt instead. */
  version?: string;
  sourceFile?: string;
  embedder: string;
  url?: string;
  kind?: string;
  collection?: string;
  parent?: string;
  fetchedAt?: string;
  /** Ranking multiplier: governing and current sources > historical ones. */
  weight?: number;
}

/** Which searchable corpus to use, and optionally which section of it. */
export interface Scope {
  embedder: string;
  collection?: string | null;
}

export interface CorpusInfo {
  embedder: string;
  documents: number;
  chunks: number;
  /** Chunk counts per section. */
  collections: Record<string, number>;
  /** Newest crawl or ingest time. */
  updatedAt: string | null;
}

async function insertDocument(client: Queryable, doc: DocumentInput, chunks: Chunk[], embeddings: number[][]): Promise<number> {
  if (chunks.length !== embeddings.length) throw new Error("chunks and embeddings differ in length");
  await client.query("DELETE FROM documents WHERE coalesce(url, title || '@' || version) = $1 AND embedder = $2", [
    doc.url ?? `${doc.title}@${doc.version ?? ""}`,
    doc.embedder,
  ]);
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO documents (title, version, source_file, embedder, url, kind, collection, parent, fetched_at, weight)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [doc.title, doc.version ?? "", doc.sourceFile ?? doc.url ?? "", doc.embedder, doc.url ?? null, doc.kind ?? "document", doc.collection ?? "funding", doc.parent ?? null, doc.fetchedAt ?? null, doc.weight ?? 1],
  );
  const documentId = rows[0].id;
  // Multi-row inserts: one round trip per 100 chunks instead of one per chunk.
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    const values: unknown[] = [];
    const freqs = batch.map((c) => termFrequencies(`${doc.title} ${c.section} ${c.content}`));
    const tuples = batch.map((c, j) => {
      const b = j * 10;
      const termCount = [...freqs[j].values()].reduce((s, n) => s + n, 0);
      values.push(documentId, c.ordinal, c.section, c.pageStart, c.pageEnd, c.content, toSql(embeddings[i + j]), c.url ?? null, c.collection ?? doc.collection ?? "funding", termCount);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::vector, $${b + 8}, $${b + 9}, $${b + 10})`;
    });
    const { rows: ids } = await client.query<{ id: number }>(
      `INSERT INTO chunks (document_id, ordinal, section, page_start, page_end, content, embedding, url, collection, term_count)
       VALUES ${tuples.join(", ")} RETURNING id`,
      values,
    );
    // The inverted index for BM25, as three parallel arrays (one round trip per batch).
    const chunkIds: number[] = [];
    const termList: string[] = [];
    const tfs: number[] = [];
    ids.forEach(({ id }, j) => {
      for (const [term, tf] of freqs[j]) {
        chunkIds.push(id);
        termList.push(term);
        tfs.push(Math.min(tf, 32767));
      }
    });
    if (chunkIds.length) {
      await client.query("INSERT INTO chunk_terms (chunk_id, term, tf) SELECT * FROM unnest($1::int[], $2::text[], $3::smallint[])", [chunkIds, termList, tfs]);
    }
  }
  return documentId;
}

async function inTransaction<T>(pool: DbPool, fn: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Replaces any previous ingest of the same source and embedder, in one transaction. */
export async function saveDocument(pool: DbPool, doc: DocumentInput, chunks: Chunk[], embeddings: number[][]): Promise<number> {
  return inTransaction(pool, (client) => insertDocument(client, doc, chunks, embeddings));
}

/**
 * Replaces everything stored for one embedder with a new corpus, in one transaction, so
 * a half-finished ingest is never visible to questions being answered.
 */
export async function replaceCorpus(
  pool: DbPool,
  embedder: string,
  items: { doc: Omit<DocumentInput, "embedder">; chunks: Chunk[]; embeddings: number[][] }[],
): Promise<number> {
  return inTransaction(pool, async (client) => {
    await client.query("DELETE FROM documents WHERE embedder = $1", [embedder]);
    for (const item of items) await insertDocument(client, { ...item.doc, embedder }, item.chunks, item.embeddings);
    return items.length;
  });
}

/**
 * The corpus questions are answered from. `embedders` lists the embedder names allowed in the
 * current mode, most preferred first (e.g. ["openai:text-embedding-3-small", "hash:bow2-1536"]).
 */
export async function getActiveCorpus(pool: DbPool, embedders: string[]): Promise<CorpusInfo | null> {
  const { rows } = await pool.query<{ embedder: string; documents: number; chunks: number; updated_at: string | null }>(
    `SELECT d.embedder, count(DISTINCT d.id)::int AS documents, count(c.id)::int AS chunks,
            max(coalesce(d.fetched_at, d.ingested_at))::text AS updated_at
       FROM documents d JOIN chunks c ON c.document_id = d.id
      WHERE d.embedder = ANY($1)
      GROUP BY d.embedder
      ORDER BY array_position($1, d.embedder), count(c.id) DESC
      LIMIT 1`,
    [embedders],
  );
  if (!rows[0]) return null;
  const { rows: byCollection } = await pool.query<{ collection: string; n: number }>(
    `SELECT c.collection, count(*)::int AS n FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.embedder = $1 GROUP BY c.collection`,
    [rows[0].embedder],
  );
  return {
    embedder: rows[0].embedder,
    documents: rows[0].documents,
    chunks: rows[0].chunks,
    collections: Object.fromEntries(byCollection.map((r) => [r.collection, r.n])),
    updatedAt: rows[0].updated_at,
  };
}

const COLUMNS = `c.id, c.ordinal, c.section, c.page_start, c.page_end, c.content, c.url, c.collection, d.title, d.kind, d.weight`;

function toChunk(r: Record<string, unknown>, similarity: number): RetrievedChunk {
  return {
    id: r.id as number,
    ordinal: r.ordinal as number,
    section: r.section as string,
    pageStart: r.page_start as number,
    pageEnd: r.page_end as number,
    content: r.content as string,
    url: (r.url as string | null) ?? undefined,
    collection: r.collection as string,
    title: r.title as string,
    kind: r.kind as string,
    weight: Number(r.weight ?? 1),
    similarity,
  };
}

/** Top-k chunks by cosine similarity (pgvector's <=> is cosine distance). */
export async function searchChunks(pool: DbPool, scope: Scope, queryEmbedding: number[], k: number): Promise<RetrievedChunk[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}, 1 - (c.embedding <=> $1::vector) AS similarity
       FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.embedder = $2 AND ($3::text IS NULL OR c.collection = $3)
      ORDER BY c.embedding <=> $1::vector
      LIMIT $4`,
    [toSql(queryEmbedding), scope.embedder, scope.collection ?? null, k],
  );
  return rows.map((r) => toChunk(r, Number(r.similarity)));
}

/** BM25 parameters, shared with the phone build (web/src/engine.ts). */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/**
 * Top-k chunks by BM25 over the inverted index: each query term scores
 * idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * len / avglen)), summed over terms.
 * IDF and average length come from the whole corpus for this embedder.
 */
export async function keywordSearch(pool: DbPool, scope: Scope, query: string, k: number): Promise<RetrievedChunk[]> {
  const queryTerms = [...new Set(terms(query))];
  if (!queryTerms.length) return [];
  const { rows } = await pool.query(
    `WITH corpus AS (
       SELECT c.id, c.term_count FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.embedder = $2
     ),
     stats AS (SELECT count(*)::float8 AS n, greatest(avg(term_count), 1)::float8 AS avglen FROM corpus),
     df AS (
       SELECT t.term, count(*)::float8 AS df FROM chunk_terms t JOIN corpus ON corpus.id = t.chunk_id
        WHERE t.term = ANY($1::text[]) GROUP BY t.term
     ),
     scored AS (
       SELECT t.chunk_id,
              sum(ln(1 + (stats.n - df.df + 0.5) / (df.df + 0.5))
                  * t.tf * ($5::float8 + 1) / (t.tf + $5::float8 * (1 - $6::float8 + $6::float8 * c.term_count / stats.avglen))) AS score
         FROM chunk_terms t
         JOIN df ON df.term = t.term
         JOIN chunks c ON c.id = t.chunk_id
         JOIN documents d ON d.id = c.document_id
         CROSS JOIN stats
        WHERE t.term = ANY($1::text[]) AND d.embedder = $2 AND ($3::text IS NULL OR c.collection = $3)
        GROUP BY t.chunk_id
        ORDER BY score DESC
        LIMIT $4
     )
     SELECT ${COLUMNS}, scored.score AS rank
       FROM scored JOIN chunks c ON c.id = scored.chunk_id JOIN documents d ON d.id = c.document_id
      ORDER BY scored.score DESC, c.id`,
    [queryTerms, scope.embedder, scope.collection ?? null, k, BM25_K1, BM25_B],
  );
  return rows.map((r) => toChunk(r, 0));
}

/** Stores a derived dataset (e.g. the directory) by key. */
export async function setMeta(pool: DbPool, key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO meta (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function getMeta<T>(pool: DbPool, key: string): Promise<T | null> {
  const { rows } = await pool.query<{ value: T | string }>("SELECT value FROM meta WHERE key = $1", [key]);
  if (!rows[0]) return null;
  // node-postgres parses jsonb; PGlite may hand back a string.
  return typeof rows[0].value === "string" ? (JSON.parse(rows[0].value) as T) : rows[0].value;
}
