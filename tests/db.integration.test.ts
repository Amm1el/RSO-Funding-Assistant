import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { DbPool } from "../src/dbpool.js";
import { createPool, getActiveCorpus, keywordSearch, migrate, replaceCorpus, saveDocument, searchChunks } from "../src/db.js";
import { HashEmbedder } from "../src/embeddings.js";
import { retrieve } from "../src/pipeline.js";
import { ingestCorpus } from "../src/corpus/ingest.js";
import { manualAsDoc } from "../src/corpus/load.js";
import type { Chunk } from "../src/types.js";

// Runs against a real Postgres + pgvector when TEST_DATABASE_URL is set (CI does this),
// otherwise against embedded PGlite in memory, so these tests always run.
const url = process.env.TEST_DATABASE_URL ?? "pglite://memory";

describe(`Postgres + pgvector (${url.split(":")[0]})`, () => {
  let pool: DbPool;
  const embedder = new HashEmbedder();
  const scope = { embedder: embedder.name };

  beforeAll(async () => {
    pool = createPool(url);
    await pool.query("DROP TABLE IF EXISTS chunks, documents");
    await migrate(pool);
  });
  afterAll(async () => pool?.end());

  const chunks: Chunk[] = [
    { ordinal: 0, section: "LODGING", pageStart: 12, pageEnd: 12, content: "Daily hotel rate should not exceed $225 per night before tax", collection: "funding" },
    { ordinal: 1, section: "Prohibited Purchases", pageStart: 10, pageEnd: 10, content: "Alcohol gift cards flowers for individuals", collection: "funding" },
    { ordinal: 2, section: "Chapter 702 The Office Of The Supervisor Of Elections", pageStart: 0, pageEnd: 0, content: "The Supervisor of Elections shall certify candidates and run the election", collection: "elections", url: "https://fsusga.municipalcodeonline.com/book?type=plan#name=Chapter_702" },
  ];
  const save = async (title: string, items: Chunk[], u?: string) =>
    saveDocument(pool, { title, version: "t1", embedder: embedder.name, url: u }, items, await embedder.embed(items.map((c) => c.content)));

  it("stores chunks and finds the nearest one", async () => {
    await save("Test Manual", chunks);
    const [q] = await embedder.embed(["what is the hotel rate per night"]);
    const results = await searchChunks(pool, scope, q, 2);
    expect(results[0]).toMatchObject({ section: "LODGING", title: "Test Manual", collection: "funding" });
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it("limits vector and keyword search to one section", async () => {
    const [q] = await embedder.embed(["who certifies candidates in the election"]);
    expect((await searchChunks(pool, { ...scope, collection: "funding" }, q, 5)).every((c) => c.collection === "funding")).toBe(true);
    const elections = await keywordSearch(pool, { ...scope, collection: "elections" }, "supervisor certify candidates", 5);
    expect(elections.map((c) => c.section)).toEqual(["Chapter 702 The Office Of The Supervisor Of Elections"]);
    expect(elections[0].url).toContain("#name=Chapter_702");
  });

  it("re-ingesting the same source replaces it instead of duplicating", async () => {
    await save("Test Manual", chunks);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM chunks");
    expect(rows[0].n).toBe(3);
  });

  it("reports the active corpus with counts per section, per embedder", async () => {
    const info = await getActiveCorpus(pool, ["hash"]);
    expect(info).toMatchObject({ embedder: "hash:bow-1536", documents: 1, chunks: 3, collections: { funding: 2, elections: 1 } });
    expect(await getActiveCorpus(pool, ["openai"])).toBeNull();
  });

  it("replaces a whole corpus in one transaction, and rolls back on failure", async () => {
    await expect(
      replaceCorpus(pool, embedder.name, [{ doc: { title: "Bad", url: "https://x/bad" }, chunks, embeddings: [] }]),
    ).rejects.toThrow();
    expect((await getActiveCorpus(pool, ["hash"]))?.chunks).toBe(3); // untouched
  });

  const manual = "data/26-27SGAFM.pdf";
  it.skipIf(!existsSync(manual))("ingests the real manual through the corpus path and retrieves the right sections", async () => {
    const summary = await ingestCorpus(pool, [await manualAsDoc(manual)], embedder, () => {});
    expect(summary.collections).toEqual({ funding: summary.chunks });
    const top = await retrieve({ pool, embedder }, "maximum daily hotel rate per night lodging", 3);
    expect(top.map((c) => c.section)).toContain("LODGING");
    expect(top.find((c) => c.section === "LODGING")?.url).toMatch(/26-27SGAFM\.pdf#page=12$/);
  });
});
