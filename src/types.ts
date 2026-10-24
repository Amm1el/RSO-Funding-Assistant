/** A piece of source text ready to embed and store. */
export interface Chunk {
  ordinal: number;
  /** Section label shown in citations, e.g. "LODGING" or "Chapter 806 Funding Boards". */
  section: string;
  /** PDF pages; 0 for sources without pages (web pages, code books, meetings). */
  pageStart: number;
  pageEnd: number;
  content: string;
  /** Deep link to this chunk's source (a PDF page, a code-book chapter, a meeting file). */
  url?: string;
  /** The app section this chunk belongs to (see src/corpus/collections.ts). */
  collection?: string;
}

/** A chunk returned by retrieval, with its cosine similarity to the question. */
export interface RetrievedChunk extends Chunk {
  id: number;
  similarity: number;
  /** Title of the source document, e.g. "2026-27 RSO Financial Manual". */
  title?: string;
  kind?: string;
}

export interface Citation {
  chunkId: number;
  section: string;
  /** "12" or "14-15"; empty for sources without pages. */
  pages: string;
  quote: string;
  title?: string;
  url?: string;
  collection?: string;
}

export interface Answer {
  answerable: boolean;
  answer: string;
  citations: Citation[];
}
