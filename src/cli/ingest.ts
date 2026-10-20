import { basename } from "node:path";
import { createPool, migrate, saveDocument } from "../db.js";
import { OpenAIEmbedder, HashEmbedder, type Embedder } from "../embeddings.js";
import { readPdfPages } from "../ingest/pdf.js";
import { chunkPages, parseTableOfContents } from "../ingest/chunk.js";

// Usage: npm run ingest -- data/26-27SGAFM.pdf [--version 2026-27] [--offline]
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? "data/26-27SGAFM.pdf";
const version = args.includes("--version") ? args[args.indexOf("--version") + 1] : "2026-27";
const offline = args.includes("--offline");

const pages = await readPdfPages(file);
const toc = parseTableOfContents(pages);
if (!toc) console.warn("No table of contents found; every chunk will be labeled 'Front matter'.");
const chunks = chunkPages(pages, { headings: toc?.headings, skipPages: toc ? [1, toc.tocPage] : [] });
console.log(`Read ${pages.length} pages, ${toc?.headings.length ?? 0} TOC headings, ${chunks.length} chunks.`);

const embedder: Embedder = offline ? new HashEmbedder() : new OpenAIEmbedder();
const embeddings = await embedder.embed(chunks.map((c) => `${c.section}\n${c.content}`));

const pool = createPool();
await migrate(pool);
const id = await saveDocument(pool, { title: "RSO Financial Manual", version, sourceFile: basename(file) }, chunks, embeddings);
console.log(`Saved document ${id} (${version})${offline ? " with offline hash embeddings" : ""}.`);
await pool.end();
