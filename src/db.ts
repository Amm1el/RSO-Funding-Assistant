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

/** Replaces any previous ingest of the same title/version in one transaction. */
export async function saveDocument(
  pool: pg.Pool,
  doc: { title: string; version: string; sourceFile: string },
  chunks: Chunk[],
  embeddings: number[][],
): Promise<number> {
  if (chunks.length !== embeddings.length) throw new Error("chunks and embeddings differ in length");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM documents WHERE title = $1 AND version = $2", [doc.title, doc.version]);
    const { rows } = await client.query<{ id: number }>(
      "INSERT INTO documents (title, version, source_file) VALUES ($1, $2, $3) RETURNING id",
      [doc.title, doc.version, doc.sourceFile],
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

/** Top-k chunks by cosine similarity (pgvector's <=> is cosine distance). */
export async function searchChunks(pool: pg.Pool, queryEmbedding: number[], k: number): Promise<RetrievedChunk[]> {
  const { rows } = await pool.query(
    `SELECT id, ordinal, section, page_start, page_end, content,
            1 - (embedding <=> $1::vector) AS similarity
       FROM chunks
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    [toSql(queryEmbedding), k],
  );
  return rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    section: r.section,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    content: r.content,
    similarity: Number(r.similarity),
  }));
}
