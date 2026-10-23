import { readFile } from "node:fs/promises";
import pg from "pg";
import { toSql } from "pgvector";
import { config } from "./config.js";
import type { Chunk, RetrievedChunk } from "./types.js";

export function createPool(connectionString = config.DATABASE_URL): pg.Pool {
  return new pg.Pool({ connectionString });
}

export async function migrate(pool: pg.Pool): Promise<void> {
  const sql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

export interface DocumentInfo {
  id: number;
  title: string;
  version: string;
  embedder: string;
  chunks: number;
}

/** Replaces any previous ingest of the same title, version and embedder in one transaction. */
export async function saveDocument(
  pool: pg.Pool,
  doc: { title: string; version: string; sourceFile: string; embedder: string },
  chunks: Chunk[],
  embeddings: number[][],
): Promise<number> {
  if (chunks.length !== embeddings.length) throw new Error("chunks and embeddings differ in length");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM documents WHERE title = $1 AND version = $2 AND embedder = $3", [doc.title, doc.version, doc.embedder]);
    const { rows } = await client.query<{ id: number }>(
      "INSERT INTO documents (title, version, source_file, embedder) VALUES ($1, $2, $3, $4) RETURNING id",
      [doc.title, doc.version, doc.sourceFile, doc.embedder],
    );
    const documentId = rows[0].id;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      await client.query(
        `INSERT INTO chunks (document_id, ordinal, section, page_start, page_end, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
        [documentId, c.ordinal, c.section, c.pageStart, c.pageEnd, c.content, toSql(embeddings[i])],
      );
    }
    await client.query("COMMIT");
    return documentId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The document questions are answered from. `providers` lists the embedding providers
 * allowed in the current mode, most preferred first (e.g. ["openai", "hash"]); within a
 * provider, the most recent ingest wins.
 */
export async function getActiveDocument(pool: pg.Pool, providers: string[] = ["hash"]): Promise<DocumentInfo | null> {
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.version, d.embedder, count(c.id)::int AS chunks
       FROM documents d JOIN chunks c ON c.document_id = d.id
      WHERE split_part(d.embedder, ':', 1) = ANY($1)
      GROUP BY d.id
      ORDER BY array_position($1, split_part(d.embedder, ':', 1)), d.ingested_at DESC, d.id DESC
      LIMIT 1`,
    [providers],
  );
  return rows[0] ?? null;
}

const COLUMNS = "id, ordinal, section, page_start, page_end, content";

function toChunk(r: Record<string, unknown>, similarity: number): RetrievedChunk {
  return {
    id: r.id as number,
    ordinal: r.ordinal as number,
    section: r.section as string,
    pageStart: r.page_start as number,
    pageEnd: r.page_end as number,
    content: r.content as string,
    similarity,
  };
}

/** Top-k chunks by cosine similarity (pgvector's <=> is cosine distance). */
export async function searchChunks(pool: pg.Pool, documentId: number, queryEmbedding: number[], k: number): Promise<RetrievedChunk[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}, 1 - (embedding <=> $1::vector) AS similarity
       FROM chunks
      WHERE document_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [toSql(queryEmbedding), documentId, k],
  );
  return rows.map((r) => toChunk(r, Number(r.similarity)));
}

/**
 * Top-k chunks by Postgres full-text rank. The question's words are OR-ed together
 * (plainto_tsquery would AND them, and a natural-language question rarely matches every
 * word), stemmed, and stripped of stop words by the 'english' configuration.
 */
export async function keywordSearch(pool: pg.Pool, documentId: number, query: string, k: number): Promise<RetrievedChunk[]> {
  const { rows } = await pool.query(
    `WITH q AS (
       SELECT to_tsquery('english', replace(plainto_tsquery('english', $1)::text, ' & ', ' | ')) AS query
     )
     -- Normalization 1 divides by log(length), so long chunks don't win just by containing more words.
     SELECT ${COLUMNS}, ts_rank_cd(tsv, q.query, 1) AS rank
       FROM chunks, q
      WHERE document_id = $2 AND q.query IS NOT NULL AND tsv @@ q.query
      ORDER BY rank DESC, ordinal
      LIMIT $3`,
    [query, documentId, k],
  );
  return rows.map((r) => toChunk(r, 0));
}
