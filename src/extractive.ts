import type { AnswerGenerator, AnswerToolInput } from "./answer.js";
import type { RetrievedChunk } from "./types.js";
import { terms } from "./terms.js";

export { stem, terms } from "./terms.js";

/**
 * A no-LLM baseline: answers by quoting up to three sentences from the retrieved passages
 * that best match the question, with rare question words counting more than common ones. It runs without an API key, so the app works
 * out of the box and CI can score the whole pipeline on every push. The gap between this
 * and Claude in the eval is the value the LLM adds.
 */
export class ExtractiveGenerator implements AnswerGenerator {
  readonly name = "extractive";

  async generate(question: string, chunks: RetrievedChunk[]): Promise<AnswerToolInput> {
    return extractAnswer(question, chunks);
  }
}

/** Splits a passage into sentences and bullet items. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9‣•])|\s*[‣•]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);
}

const ASKS_FOR_NUMBER = /\b(how (much|many|long|far|early|soon)|maximum|max|minimum|limit|cap|deadline|when|rate|percent)\b/i;

const WEIGHTS = { number: 0.75, rank: 0.5 };
const MAX_PICKS = 3;


export function extractAnswer(question: string, chunks: RetrievedChunk[]): AnswerToolInput {
  const wanted = new Set(terms(question));
  const wantsNumber = ASKS_FOR_NUMBER.test(question);

  const candidates = chunks.flatMap((chunk, i) => sentences(chunk.content).map((sentence) => ({ i, sentence, have: new Set(terms(sentence)) })));
  // A question word that appears in most candidate sentences ("funds", "student") says little
  // about which one answers it; a rare one ("Venmo", "dues") says a lot. Weight by local IDF.
  const df = new Map<string, number>();
  for (const c of candidates) for (const t of wanted) if (c.have.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + candidates.length / (df.get(t) ?? 1));
  const meanIdf = wanted.size ? [...wanted].reduce((s, t) => s + idf(t), 0) / wanted.size : 1;
  const scored = candidates.map(({ i, sentence, have }) => {
    const matched = [...wanted].filter((t) => have.has(t));
    const weight = matched.reduce((s, t) => s + idf(t), 0) / meanIdf;
    const numberBonus = wantsNumber && /[$\d]/.test(sentence) ? WEIGHTS.number : 0;
    // Earlier passages are more relevant; break ties toward them.
    return { excerpt: i + 1, sentence, overlap: matched.length, score: weight + numberBonus + WEIGHTS.rank / (i + 1) };
  });
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  // Refuse only when almost nothing matches. A stricter cutoff (IDF coverage 0.35-0.55)
  // was tried: it refused more off-topic questions but lost more correct answers (DECISIONS #38).
  if (!best || best.overlap < 2) {
    return { answerable: false, answer: "The retrieved passages don't clearly answer this question.", citations: [] };
  }
  const picks = [best];
  for (const s of scored) {
    if (picks.length >= MAX_PICKS) break;
    if (s.overlap >= 2 && s.score >= best.score * 0.7 && !picks.some((p) => p.sentence === s.sentence)) picks.push(s);
  }

  return {
    answerable: true,
    answer: picks.map((p) => p.sentence).join(" "),
    citations: picks.map((p) => ({ excerpt: p.excerpt, quote: p.sentence })),
  };
}
