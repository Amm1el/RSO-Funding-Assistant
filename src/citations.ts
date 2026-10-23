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

/**
 * Keeps only citations that point at a real excerpt and whose quote actually appears in it.
 * This is the guard against the model inventing sources.
 */
export function validateCitations(raw: RawAnswer["citations"], chunks: RetrievedChunk[]): Citation[] {
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of raw) {
    const chunk = chunks[c.excerpt - 1];
    if (!chunk) continue;
    if (!squash(chunk.content).includes(squash(c.quote))) continue;
    const key = `${chunk.id}:${c.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      chunkId: chunk.id,
      section: chunk.section,
      pages: chunk.pageStart === chunk.pageEnd ? `${chunk.pageStart}` : `${chunk.pageStart}-${chunk.pageEnd}`,
      quote: c.quote,
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
      answer: "I couldn't find support for an answer in the Financial Manual. Please check with SGA directly.",
      citations: [],
    };
  }
  return { answerable: raw.answerable, answer: raw.answer, citations };
}
