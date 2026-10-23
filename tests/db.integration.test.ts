import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { DbPool } from "../src/dbpool.js";
import { createPool, getActiveDocument, migrate, saveDocument, searchChunks } from "../src/db.js";
import { HashEmbedder } from "../src/embeddings.js";
import { readPdfPages } from "../src/ingest/pdf.js";
import { chunkPages, parseTableOfContents } from "../src/ingest/chunk.js";
import { retrieve } from "../src/pipeline.js";
import type { Chunk } from "../src/types.js";

// Runs against a real Postgres + pgvector when TEST_DATABASE_URL is set (CI does this),
// otherwise against embedded PGlite in memory, so these tests always run.
const url = process.env.TEST_DATABASE_URL ?? "pglite://memory";

describe(`Postgres + pgvector (${url.split(":")[0]})`, () => {
  let pool: DbPool;
  const embedder = new HashEmbedder();

  beforeAll(async () => {
    pool = createPool(url);
    await pool.query("DROP TABLE IF EXISTS chunks, documents");
    await migrate(pool);
  });
  afterAll(async () => pool?.end());

  const chunks: Chunk[] = [
    { ordinal: 0, section: "LODGING", pageStart: 12, pageEnd: 12, content: "Daily hotel rate should not exceed $225 per night before tax" },
    { ordinal: 1, section: "Prohibited Purchases", pageStart: 10, pageEnd: 10, content: "Alcohol gift cards flowers for individuals" },
    { ordinal: 2, section: "Receipts", pageStart: 14, pageEnd: 14, content: "Submit receipts within ten business days of the event" },
  ];

  it("stores chunks and finds the nearest one", async () => {
    const vectors = await embedder.embed(chunks.map((c) => c.content));
    const docId = await saveDocument(pool, { title: "Test Manual", version: "t1", sourceFile: "t.pdf", embedder: embedder.name }, chunks, vectors);
    const [q] = await embedder.embed(["what is the hotel rate per night"]);
    const results = await searchChunks(pool, docId, q, 2);
    expect(results[0].section).toBe("LODGING");
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it("re-ingesting the same version replaces it instead of duplicating", async () => {
    const vectors = await embedder.embed(chunks.map((c) => c.content));
    await saveDocument(pool, { title: "Test Manual", version: "t1", sourceFile: "t.pdf", embedder: embedder.name }, chunks, vectors);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM chunks");
    expect(rows[0].n).toBe(3);
  });

  it("keeps one copy per embedder and picks the copy the current mode allows", async () => {
    const vectors = await embedder.embed(chunks.map((c) => c.content));
    const hashId = await saveDocument(pool, { title: "Modes", version: "m1", sourceFile: "m.pdf", embedder: "hash:bow-1536" }, chunks, vectors);
    const openaiId = await saveDocument(pool, { title: "Modes", version: "m1", sourceFile: "m.pdf", embedder: "openai:text-embedding-3-small" }, chunks, vectors);
    expect((await getActiveDocument(pool, ["hash"]))?.id).toBe(hashId);
    expect((await getActiveDocument(pool, ["openai", "hash"]))?.id).toBe(openaiId);
    expect(await getActiveDocument(pool, ["voyage"])).toBeNull();
  });

  it("rolls back when chunks and embeddings don't line up", async () => {
    await expect(saveDocument(pool, { title: "Bad", version: "x", sourceFile: "x", embedder: embedder.name }, chunks, [])).rejects.toThrow();
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM documents WHERE title = 'Bad'");
    expect(rows[0].n).toBe(0);
  });

  const manual = "data/26-27SGAFM.pdf";
  it.skipIf(!existsSync(manual))("ingests the real manual and retrieves the right sections offline", async () => {
    const pages = await readPdfPages(manual);
    const toc = parseTableOfContents(pages)!;
    const real = chunkPages(pages, { headings: toc.headings, skipPages: [1, toc.tocPage] });
    const vectors = await embedder.embed(real.map((c) => `${c.section}\n${c.content}`));
    const documentId = await saveDocument(pool, { title: "RSO Financial Manual", version: "2026-27", sourceFile: "26-27SGAFM.pdf", embedder: embedder.name }, real, vectors);
    const top = await retrieve({ pool, embedder, documentId }, "maximum daily hotel rate per night lodging", 3);
    expect(top.map((c) => c.section)).toContain("LODGING");
  });
});
