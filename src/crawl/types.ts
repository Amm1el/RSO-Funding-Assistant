/** What the crawler writes: one JSON object per source document, in corpus/<source>.jsonl. */
export type SourceKind = "page" | "document" | "code" | "meeting";

export interface CorpusSection {
  /** Heading as shown on the source, e.g. "Funding Amounts" or "Chapter 806 Funding Boards". */
  heading: string;
  text: string;
  /** PDF page number, when the section is a page. */
  page?: number;
  /** Deep link to this section, when the source supports one (municipal code anchors). */
  url?: string;
}

export interface CorpusDoc {
  /** Stable id derived from the URL. */
  id: string;
  url: string;
  title: string;
  kind: SourceKind;
  host: string;
  fetchedAt: string;
  /** The page that linked here (documents) or the book it belongs to (code). */
  parent?: string;
  sections: CorpusSection[];
  meta?: Record<string, string | number | boolean>;
}
