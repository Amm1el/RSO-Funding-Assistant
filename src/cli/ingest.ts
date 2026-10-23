import { basename } from "node:path";
import { createPool, migrate, saveDocument } from "../db.js";
import { defaultEmbedder, HashEmbedder, type Embedder } from "../embeddings.js";
import { readPdfPages } from "../ingest/pdf.js";
import { chunkPages, parseTableOfContents } from "../ingest/chunk.js";

// Usage: npm run ingest -- data/26-27SGAFM.pdf [--version 2026-27] [--offline]
// Uses OpenAI embeddings when OPENAI_API_KEY is set; --offline forces the local hash embedder.
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--version") ?? "data/26-27SGAFM.pdf";
const version = args.includes("--version") ? args[args.indexOf("--version") + 1] : "2026-27";
const embedder: Embedder = args.includes("--offline") ? new HashEmbedder() : defaultEmbedder();

const pages = await readPdfPages(file);
const toc = parseTableOfContents(pages);
if (!toc) console.warn("No table of contents found; every chunk will be labeled 'Front matter'.");
const chunks = chunkPages(pages, { headings: toc?.headings, skipPages: toc ? [1, toc.tocPage] : [] });
console.log(`Read ${pages.length} pages, ${toc?.headings.length ?? 0} TOC headings, ${chunks.length} chunks.`);

// The section title is embedded with the text, so "LODGING" helps a hotel question find its chunk.
const embeddings = await embedder.embed(chunks.map((c) => `${c.section}\n${c.content}`));

const pool = createPool();
await migrate(pool);
const id = await saveDocument(
  pool,
  { title: "RSO Financial Manual", version, sourceFile: basename(file), embedder: embedder.name },
  chunks,
  embeddings,
);
console.log(`Saved document ${id} (${version}) using ${embedder.name} embeddings.`);
await pool.end();
