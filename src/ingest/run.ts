import { basename } from "node:path";
import { migrate, saveDocument, type DbPool } from "../db.js";
import type { Embedder } from "../embeddings.js";
import { readPdfPages } from "./pdf.js";
import { chunkPages, parseTableOfContents, DEFAULT_MAX_WORDS, DEFAULT_OVERLAP_WORDS } from "./chunk.js";

export interface IngestOptions {
  version?: string;
  maxWords?: number;
  overlapWords?: number;
  log?: (message: string) => void;
}

/** PDF → chunks → embeddings → database, in one transaction. Used by the ingest CLI and the demo. */
export async function ingestManual(pool: DbPool, file: string, embedder: Embedder, options: IngestOptions = {}) {
  const log = options.log ?? console.log;
  const version = options.version ?? "2026-27";
  const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;
  const overlapWords = options.overlapWords ?? DEFAULT_OVERLAP_WORDS;

  const pages = await readPdfPages(file);
  const toc = parseTableOfContents(pages);
  if (!toc) log("No table of contents found; every chunk will be labeled 'Front matter'.");
  const chunks = chunkPages(pages, { headings: toc?.headings, skipPages: toc ? [1, toc.tocPage] : [], maxWords, overlapWords });
  log(`Read ${pages.length} pages, ${toc?.headings.length ?? 0} TOC headings, ${chunks.length} chunks (max ${maxWords} words, ${overlapWords} overlap).`);

  // The section title is embedded with the text, so "LODGING" helps a hotel question find its chunk.
  const embeddings = await embedder.embed(chunks.map((c) => `${c.section}\n${c.content}`));

  await migrate(pool);
  const id = await saveDocument(
    pool,
    { title: "RSO Financial Manual", version, sourceFile: basename(file), embedder: embedder.name },
    chunks,
    embeddings,
  );
  log(`Saved document ${id} (${version}) using ${embedder.name} embeddings.`);
  return { id, chunks: chunks.length };
}
