import type { CorpusDoc } from "../crawl/types.js";
import type { Chunk } from "../types.js";
import { chunkPages, detectBoilerplate, parseTableOfContents, DEFAULT_MAX_WORDS, DEFAULT_OVERLAP_WORDS } from "../ingest/chunk.js";
import { classify, type CollectionId } from "./collections.js";

export interface DocChunks {
  doc: CorpusDoc;
  /** The document's main section (most common across its chunks). */
  collection: CollectionId;
  chunks: Chunk[];
}

/** Splits text into overlapping word windows. */
function windows(text: string, maxWords: number, overlap: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let start = 0; start < words.length; start += maxWords - overlap) {
    out.push(words.slice(start, start + maxWords).join(" "));
    if (start + maxWords >= words.length) break;
  }
  return out;
}

/**
 * Turns one crawled source into chunks.
 * - PDFs with a table of contents get the same TOC-guided, section-aware chunking as the
 *   Financial Manual, with running headers detected per document.
 * - Other PDFs are chunked across pages, keeping page numbers.
 * - Web pages, code books and meetings are chunked within each of their own sections.
 */
export function docToChunks(doc: CorpusDoc, opts: { parentCollection?: CollectionId | null; maxWords?: number; overlapWords?: number } = {}): DocChunks {
  const maxWords = opts.maxWords ?? DEFAULT_MAX_WORDS;
  const overlapWords = opts.overlapWords ?? DEFAULT_OVERLAP_WORDS;
  const chunks: Chunk[] = [];
  const isPaged = doc.kind === "document" && doc.sections.some((s) => s.page);

  if (isPaged) {
    const last = Math.max(...doc.sections.map((s) => s.page ?? 0));
    const pages = Array.from({ length: last }, (_, i) => doc.sections.find((s) => s.page === i + 1)?.text ?? "");
    const toc = parseTableOfContents(pages);
    const useToc = toc && toc.headings.length >= 5;
    const collection = classify(doc, doc.sections[0], opts.parentCollection);
    for (const c of chunkPages(pages, {
      headings: useToc ? toc.headings : [],
      skipPages: useToc ? [toc.tocPage] : [],
      maxWords,
      overlapWords,
      defaultSection: useToc ? "Introduction" : doc.title,
      boilerplate: pages.length >= 4 ? detectBoilerplate(pages) : undefined,
    })) {
      chunks.push({ ...c, ordinal: chunks.length, url: `${doc.url}#page=${c.pageStart}`, collection });
    }
  } else {
    for (const section of doc.sections) {
      const collection = classify(doc, section, opts.parentCollection);
      const label = section.heading && section.heading !== doc.title ? section.heading : doc.title;
      for (const content of windows(section.text, maxWords, overlapWords)) {
        chunks.push({
          ordinal: chunks.length,
          section: label,
          pageStart: section.page ?? 0,
          pageEnd: section.page ?? 0,
          content,
          url: section.url ?? doc.url,
          collection,
        });
      }
    }
  }

  const tally = new Map<string, number>();
  for (const c of chunks) tally.set(c.collection!, (tally.get(c.collection!) ?? 0) + 1);
  const collection = ([...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? classify(doc, doc.sections[0] ?? { heading: "", text: "" }, opts.parentCollection)) as CollectionId;
  return { doc, collection, chunks };
}
