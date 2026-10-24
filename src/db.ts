import { readFile } from "node:fs/promises";
import { toSql } from "pgvector";
import { config } from "./config.js";
import { createDbPool, type DbPool, type Queryable } from "./dbpool.js";
import type { Chunk, RetrievedChunk } from "./types.js";

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
    `INSERT INTO documents (title, version, source_file, embedder, url, kind, collection, parent, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [doc.title, doc.version ?? "", doc.sourceFile ?? doc.url ?? "", doc.embedder, doc.url ?? null, doc.kind ?? "document", doc.collection ?? "funding", doc.parent ?? null, doc.fetchedAt ?? null],
  );
  const documentId = rows[0].id;
  // Multi-row inserts: one round trip per 100 chunks instead of one per chunk.
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    const values: unknown[] = [];
    const tuples = batch.map((c, j) => {
      const b = j * 9;
      values.push(documentId, c.ordinal, c.section, c.pageStart, c.pageEnd, c.content, toSql(embeddings[i + j]), c.url ?? null, c.collection ?? doc.collection ?? "funding");
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::vector, $${b + 8}, $${b + 9})`;
    });
    await client.query(
      `INSERT INTO chunks (document_id, ordinal, section, page_start, page_end, content, embedding, url, collection) VALUES ${tuples.join(", ")}`,
      values,
    );
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
 * The corpus questions are answered from. `providers` lists the embedding providers allowed
 * in the current mode, most preferred first (e.g. ["openai", "hash"]).
 */
export async function getActiveCorpus(pool: DbPool, providers: string[] = ["hash"]): Promise<CorpusInfo | null> {
  const { rows } = await pool.query<{ embedder: string; documents: number; chunks: number; updated_at: string | null }>(
    `SELECT d.embedder, count(DISTINCT d.id)::int AS documents, count(c.id)::int AS chunks,
            max(coalesce(d.fetched_at, d.ingested_at))::text AS updated_at
       FROM documents d JOIN chunks c ON c.document_id = d.id
      WHERE split_part(d.embedder, ':', 1) = ANY($1)
      GROUP BY d.embedder
      ORDER BY array_position($1, split_part(d.embedder, ':', 1)), count(c.id) DESC
      LIMIT 1`,
    [providers],
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

const COLUMNS = `c.id, c.ordinal, c.section, c.page_start, c.page_end, c.content, c.url, c.collection, d.title, d.kind`;

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

/**
 * Top-k chunks by Postgres full-text rank. The question's words are OR-ed together
 * (plainto_tsquery would AND them, and a natural-language question rarely matches every
 * word), stemmed, and stripped of stop words by the 'english' configuration.
 */
export async function keywordSearch(pool: DbPool, scope: Scope, query: string, k: number): Promise<RetrievedChunk[]> {
  const { rows } = await pool.query(
    `WITH q AS (
       SELECT to_tsquery('english', replace(plainto_tsquery('english', $1)::text, ' & ', ' | ')) AS query
     )
     -- Normalization 1 divides by log(length), so long chunks don't win just by containing more words.
     SELECT ${COLUMNS}, ts_rank_cd(c.tsv, q.query, 1) AS rank
       FROM chunks c JOIN documents d ON d.id = c.document_id, q
      WHERE d.embedder = $2 AND ($3::text IS NULL OR c.collection = $3)
        AND q.query IS NOT NULL AND c.tsv @@ q.query
      ORDER BY rank DESC, c.id
      LIMIT $4`,
    [query, scope.embedder, scope.collection ?? null, k],
  );
  return rows.map((r) => toChunk(r, 0));
}
