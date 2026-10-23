import { basename } from "node:path";
import { createPool, migrate, saveDocument } from "../db.js";
import { defaultEmbedder, HashEmbedder, type Embedder } from "../embeddings.js";
import { readPdfPages } from "../ingest/pdf.js";
import { chunkPages, parseTableOfContents, DEFAULT_MAX_WORDS, DEFAULT_OVERLAP_WORDS } from "../ingest/chunk.js";

// Usage: npm run ingest -- data/26-27SGAFM.pdf [--version 2026-27] [--offline] [--max-words 300] [--overlap 50]
// Uses OpenAI embeddings when OPENAI_API_KEY is set; --offline forces the local hash embedder.
const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const valueFlags = new Set(["--version", "--max-words", "--overlap"]);
const file = args.find((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1])) ?? "data/26-27SGAFM.pdf";
const version = flag("--version") ?? "2026-27";
const maxWords = Number(flag("--max-words") ?? DEFAULT_MAX_WORDS);
const overlapWords = Number(flag("--overlap") ?? DEFAULT_OVERLAP_WORDS);
const embedder: Embedder = args.includes("--offline") ? new HashEmbedder() : defaultEmbedder();

const pages = await readPdfPages(file);
const toc = parseTableOfContents(pages);
if (!toc) console.warn("No table of contents found; every chunk will be labeled 'Front matter'.");
const chunks = chunkPages(pages, { headings: toc?.headings, skipPages: toc ? [1, toc.tocPage] : [], maxWords, overlapWords });
console.log(`Read ${pages.length} pages, ${toc?.headings.length ?? 0} TOC headings, ${chunks.length} chunks (max ${maxWords} words, ${overlapWords} overlap).`);

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
