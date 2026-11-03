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

/** Shortest piece of a quote that may stand alone when the model skipped words between pieces. */
const MIN_PIECE_WORDS = 4;
/** A skipped stretch must be at least this long (one dropped word is a typo or a trick)... */
const MIN_SKIP_WORDS = 2;
const MAX_SKIP_WORDS = 40;
/** ...and may never contain a word that flips or narrows meaning. */
const MEANING_WORDS = new Set(["not", "no", "never", "cannot", "cant", "can't", "nor", "none", "except", "unless", "without", "only", "prohibited", "may", "must", "shall"]);

/**
 * Where a quote appears in a passage, as the passage's own text, or null. Either the whole
 * quote is one exact run of words, or the model skipped words without marking it: then the
 * quote must split into pieces of at least MIN_PIECE_WORDS exact words, in the passage's
 * order, and each skipped stretch must be 2-40 words with no word that flips or narrows
 * meaning ("not", "except", "only", "must"...), so a skip can't turn "should not exceed"
 * into "should exceed". Skipped stretches are shown as " … ".
 */
function findSpan(content: string, contentTokens: ReturnType<typeof tokens>, quote: string): string | null {
  const q = tokens(quote).map((t) => t.norm);
  if (!q.length) return null;
  const text = (a: number, b: number) => content.slice(contentTokens[a].start, contentTokens[b].end).replace(/^[^\w$]+|[^\w%)]+$/g, "");
  // Longest exact run of q[from..] starting at or after content position `pos`.
  const longest = (from: number, pos: number) => {
    let best = { at: -1, len: 0 };
    for (let i = pos; i < contentTokens.length; i++) {
      let len = 0;
      while (from + len < q.length && i + len < contentTokens.length && contentTokens[i + len].norm === q[from + len]) len++;
      if (len > best.len) best = { at: i, len };
      if (from + len === q.length && len === best.len) break;
    }
    return best;
  };
  const whole = longest(0, 0);
  if (whole.len === q.length) return text(whole.at, whole.at + q.length - 1);
  const pieces: string[] = [];
  for (let from = 0, pos = 0; from < q.length; ) {
    const run = longest(from, pos);
    if (run.len < Math.min(MIN_PIECE_WORDS, q.length - from) || run.len === 0) return null;
    if (q.length - from - run.len > 0 && run.len < MIN_PIECE_WORDS) return null;
    if (pieces.length) {
      const skipped = contentTokens.slice(pos, run.at);
      if (skipped.length < MIN_SKIP_WORDS || skipped.length > MAX_SKIP_WORDS || skipped.some((t) => MEANING_WORDS.has(t.norm))) return null;
    }
    pieces.push(text(run.at, run.at + run.len - 1));
    from += run.len;
    pos = run.at + run.len;
  }
  return pieces.join(" \u2026 ");
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
