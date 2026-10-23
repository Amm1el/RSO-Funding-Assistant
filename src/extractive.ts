import type { AnswerGenerator, AnswerToolInput } from "./answer.js";
import type { RetrievedChunk } from "./types.js";

/**
 * A no-LLM baseline: answers by quoting the sentences from the retrieved passages that
 * share the most words with the question. It runs without an API key, so the app works
 * out of the box and CI can score the whole pipeline on every push. The gap between this
 * and Claude in the eval is the value the LLM adds.
 */
export class ExtractiveGenerator implements AnswerGenerator {
  readonly name = "extractive";

  async generate(question: string, chunks: RetrievedChunk[]): Promise<AnswerToolInput> {
    return extractAnswer(question, chunks);
  }
}

const STOP = new Set(
  "a an and any are as at be by can could do does for from get got has have how i if in into is it its may me might much my need no not of on or our should so than that the their them then there these they this to us was we what when where which who why will with would you your rso rsos sga".split(
    " ",
  ),
);

/** A tiny suffix stripper: "receipts" → "receipt", "recorded" → "record", "reimbursement" → "reimburse". */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of ["ment", "ing", "ed", "er", "es", "s"]) {
    if (word.endsWith(suffix) && !word.endsWith("ss") && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  return word;
}

/** Lowercased, stemmed content words, without stop words. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9$%,.]+/g) ?? [])
    .map((w) => w.replace(/[.,]+$/, ""))
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

/** Splits a passage into sentences and bullet items. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9‣•])|\s*[‣•]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4);
}

const ASKS_FOR_NUMBER = /\b(how (much|many|long|far|early|soon)|maximum|max|minimum|limit|cap|deadline|when|rate|percent)\b/i;

export function extractAnswer(question: string, chunks: RetrievedChunk[]): AnswerToolInput {
  const wanted = new Set(terms(question));
  const wantsNumber = ASKS_FOR_NUMBER.test(question);

  const scored = chunks.flatMap((chunk, i) =>
    sentences(chunk.content).map((sentence) => {
      const have = new Set(terms(sentence));
      const overlap = [...wanted].filter((t) => have.has(t)).length;
      const numberBonus = wantsNumber && /[$\d]/.test(sentence) ? 0.75 : 0;
      // Earlier passages are more relevant; break ties toward them.
      return { excerpt: i + 1, sentence, overlap, score: overlap + numberBonus + 0.5 / (i + 1) };
    }),
  );
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.overlap < 2) {
    return { answerable: false, answer: "The retrieved passages don't clearly answer this question.", citations: [] };
  }
  const picks = [best];
  const runnerUp = scored.find((s) => s !== best && s.overlap >= 2 && s.score >= best.score * 0.7 && s.sentence !== best.sentence);
  if (runnerUp) picks.push(runnerUp);

  return {
    answerable: true,
    answer: picks.map((p) => p.sentence).join(" "),
    citations: picks.map((p) => ({ excerpt: p.excerpt, quote: p.sentence })),
  };
}
