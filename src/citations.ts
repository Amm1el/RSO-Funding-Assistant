import type { Answer, Citation, RetrievedChunk } from "./types.js";

/**
 * Citation checks, kept free of server dependencies so the browser demo uses the exact
 * same code as the API.
 */
export interface RawAnswer {
  answerable: boolean;
  answer: string;
  citations: { excerpt: number; quote: string }[];
}

/** Word tokens with their character span in the original text, normalized for matching. */
function tokens(text: string): { norm: string; start: number; end: number }[] {
  const out: { norm: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const norm = m[0]
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[^a-z0-9']+/g, "")
      .replace(/^'+|'+$/g, "");
    if (norm) out.push({ norm, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** Where a run of words appears in a passage, as the passage's own text, or null. */
function findSpan(content: string, contentTokens: ReturnType<typeof tokens>, quote: string): string | null {
  const q = tokens(quote).map((t) => t.norm);
  if (!q.length) return null;
  outer: for (let i = 0; i + q.length <= contentTokens.length; i++) {
    for (let j = 0; j < q.length; j++) if (contentTokens[i + j].norm !== q[j]) continue outer;
    // The passage's own words, without punctuation hanging off either end.
    return content.slice(contentTokens[i].start, contentTokens[i + q.length - 1].end).replace(/^[^\w$]+|[^\w%)]+$/g, "");
  }
  return null;
}

/**
 * Keeps only citations whose quote really appears in a retrieved passage. This is the
 * guard against the model inventing sources.
 *
 * Matching is word for word, ignoring case, punctuation, symbols and bullet characters, so
 * small copying slips by smaller models ("1000" for "$1,000", a dropped "‣") don't throw out a
 * correct answer. A quote with "..." must have every part in the same passage. If the
 * quote isn't in the passage the model pointed to but is in another retrieved one, the
 * citation moves there. The stored quote is the passage's own text, so the UI can
 * highlight it.
 */
export function validateCitations(raw: RawAnswer["citations"], chunks: RetrievedChunk[]): Citation[] {
  const chunkTokens = chunks.map((c) => tokens(c.content));
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of raw) {
    const parts = c.quote.split(/\.{3}|\u2026/).map((p) => p.trim()).filter((p) => tokens(p).length > 0);
    if (!parts.length) continue;
    const order = [c.excerpt - 1, ...chunks.map((_, i) => i).filter((i) => i !== c.excerpt - 1)].filter((i) => chunks[i]);
    let chunk: RetrievedChunk | undefined;
    let quote = "";
    for (const i of order) {
      const spans = parts.map((p) => findSpan(chunks[i].content, chunkTokens[i], p));
      if (spans.every((x) => x !== null)) {
        chunk = chunks[i];
        quote = (spans as string[]).join(" … ");
        break;
      }
    }
    if (!chunk) continue;
    const key = `${chunk.id}:${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      chunkId: chunk.id,
      section: chunk.section,
      pages: !chunk.pageStart ? "" : chunk.pageStart === chunk.pageEnd ? `${chunk.pageStart}` : `${chunk.pageStart}-${chunk.pageEnd}`,
      quote,
      ...(chunk.title ? { title: chunk.title } : {}),
      ...(chunk.url ? { url: chunk.url } : {}),
      ...(chunk.collection ? { collection: chunk.collection } : {}),
    });
  }
  return out;
}

/**
 * Turns the model's output into the API response. An answer that claims to be
 * answerable but has no surviving citation is downgraded to unanswerable.
 */
export function finalizeAnswer(raw: RawAnswer, chunks: RetrievedChunk[]): Answer {
  const citations = validateCitations(raw.citations, chunks);
  if (raw.answerable && citations.length === 0) {
    return {
      answerable: false,
      answer: "I couldn't find support for an answer in SGA's published sources. Please check with SGA directly.",
      citations: [],
    };
  }
  return { answerable: raw.answerable, answer: raw.answer, citations };
}
