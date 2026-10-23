// Writes the manual's chunks to web/src/generated/manual-chunks.json for the phone/static
// build, which runs the keyless pipeline in the browser. Same chunker as ingest.
// Usage: npx tsx scripts/export-chunks.ts [data/26-27SGAFM.pdf]
import { writeFile } from "node:fs/promises";
import { readPdfPages } from "../src/ingest/pdf.js";
import { chunkPages, parseTableOfContents } from "../src/ingest/chunk.js";

const pages = await readPdfPages(process.argv[2] ?? "data/26-27SGAFM.pdf");
const toc = parseTableOfContents(pages)!;
const chunks = chunkPages(pages, { headings: toc.headings, skipPages: [1, toc.tocPage] });
await writeFile("web/src/generated/manual-chunks.json", JSON.stringify({ version: "2026-27", chunks }, null, 1) + "\n");
console.log(`Wrote ${chunks.length} chunks.`);
