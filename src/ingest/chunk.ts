import type { Chunk } from "../types.js";

/**
 * Lowercase and drop punctuation and spaces, so "What are A&S Fees? " matches
 * "What are A&S Fees?" and "InternationalTravel" matches "International Travel".
 */
export function normalizeHeading(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9&$]+/g, "");
}

/** Levenshtein edit distance, used to tolerate typos in the table of contents. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Returns the TOC heading a line matches, allowing roughly one typo per 12 characters. */
export function matchHeading(line: string, headings: Map<string, string>): string | undefined {
  if (line.length > 90) return undefined;
  const key = normalizeHeading(line);
  if (!key) return undefined;
  const exact = headings.get(key);
  if (exact) return exact;
  for (const [candidate, heading] of headings) {
    if (candidate.length < 10 || Math.abs(candidate.length - key.length) > 3) continue;
    if (editDistance(candidate, key) <= Math.floor(candidate.length / 12)) return heading;
  }
  return undefined;
}

/**
 * Reads section titles from the manual's table of contents, e.g.
 * "Travel Policies & Procedures....... 10". Using the TOC as the source of truth
 * means citations use the manual's own section names.
 */
export function parseTableOfContents(pages: string[]): { tocPage: number; headings: string[] } | null {
  const tocIndex = pages.findIndex((p) => /table of contents/i.test(p));
  if (tocIndex === -1) return null;
  const headings: string[] = [];
  for (const line of pages[tocIndex].split(/\r?\n/)) {
    const m = line.match(/^\s*(.+?)\s*\.{3,}\s*\d+\s*$/);
    if (m) headings.push(m[1].replace(/\s+/g, " ").trim());
  }
  return headings.length ? { tocPage: tocIndex + 1, headings } : null;
}

/** Running header/footer and bare page numbers that repeat on every page. */
const BOILERPLATE = [/^registered student organization financial manual \d{4}-\d{4}\s*\d*$/i, /^(page\s*)?\d{1,3}$/i];

export interface ChunkOptions {
  /** Section titles that start a new section (usually from the table of contents). */
  headings?: string[];
  /** 1-based pages to skip entirely, such as the cover and the table of contents. */
  skipPages?: number[];
  /** Target words per chunk. ~300 words is roughly 400 tokens. */
  maxWords?: number;
  /** Words repeated between consecutive chunks inside one section, so a rule split across a boundary still appears whole. */
  overlapWords?: number;
}

interface Paragraph {
  text: string;
  page: number;
  section: string;
}

export function toParagraphs(pages: string[], options: ChunkOptions = {}): Paragraph[] {
  const headingMap = new Map((options.headings ?? []).map((h) => [normalizeHeading(h), h]));
  const skip = new Set(options.skipPages ?? []);
  const paragraphs: Paragraph[] = [];
  let section = "Front matter";

  pages.forEach((pageText, i) => {
    const page = i + 1;
    if (skip.has(page)) return;
    let buffer: string[] = [];
    const flush = () => {
      const text = buffer.join(" ").replace(/\s+/g, " ").trim();
      if (text) paragraphs.push({ text, page, section });
      buffer = [];
    };
    for (const rawLine of pageText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        flush();
        continue;
      }
      if (BOILERPLATE.some((re) => re.test(line))) continue;
      const heading = matchHeading(line, headingMap);
      if (heading) {
        flush();
        // Label the section the way the body text spells it; the TOC has a few typos.
        section = line.replace(/\s+/g, " ");
        continue;
      }
      buffer.push(line);
    }
    flush();
  });
  return paragraphs;
}

/**
 * Section-aware chunking: chunks never cross a section boundary, so every chunk
 * can be cited by section and page. Long sections are split into overlapping windows.
 */
export function chunkPages(pages: string[], options: ChunkOptions = {}): Chunk[] {
  const maxWords = options.maxWords ?? 300;
  const overlapWords = options.overlapWords ?? 50;
  if (overlapWords >= maxWords) throw new Error("overlapWords must be smaller than maxWords");

  const chunks: Chunk[] = [];
  const paragraphs = toParagraphs(pages, options);

  let i = 0;
  while (i < paragraphs.length) {
    const section = paragraphs[i].section;
    const words: { word: string; page: number }[] = [];
    while (i < paragraphs.length && paragraphs[i].section === section) {
      for (const word of paragraphs[i].text.split(" ")) words.push({ word, page: paragraphs[i].page });
      i++;
    }
    for (let start = 0; start < words.length; start += maxWords - overlapWords) {
      const window = words.slice(start, start + maxWords);
      chunks.push({
        ordinal: chunks.length,
        section,
        pageStart: window[0].page,
        pageEnd: window[window.length - 1].page,
        content: window.map((w) => w.word).join(" "),
      });
      if (start + maxWords >= words.length) break;
    }
  }
  return chunks;
}
