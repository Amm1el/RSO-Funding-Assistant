import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Answer, RetrievedChunk } from "./types.js";

export const EvalCase = z.object({
  id: z.string(),
  question: z.string(),
  answerable: z.boolean(),
  /** Substring of the section label the answer lives in; empty means "don't score retrieval". */
  expected_section: z.string(),
  /** Facts the answer must mention (case-insensitive substring match). */
  must_include: z.array(z.string()),
  /** Set to true once checked against a real answer from the RSOAC inbox or the manual. */
  verified: z.boolean(),
});
export type EvalCase = z.infer<typeof EvalCase>;

export async function loadEvalCases(path: string): Promise<EvalCase[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return EvalCase.parse(JSON.parse(l));
      } catch (err) {
        throw new Error(`${path} line ${i + 1}: ${(err as Error).message}`);
      }
    });
}

export interface CaseResult {
  id: string;
  retrievalHit: boolean | null;
  answerableCorrect: boolean;
  factsFound: number;
  factsTotal: number;
  citations: number;
  pass: boolean;
}

/** Scores one case. Retrieval hit = the expected section appears in the retrieved chunks. */
export function scoreCase(c: EvalCase, retrieved: RetrievedChunk[], answer: Answer): CaseResult {
  const retrievalHit = c.expected_section
    ? retrieved.some((r) => r.section.toLowerCase().includes(c.expected_section.toLowerCase()))
    : null;
  const text = answer.answer.toLowerCase();
  const factsFound = c.must_include.filter((f) => text.includes(f.toLowerCase())).length;
  const answerableCorrect = answer.answerable === c.answerable;
  const citedWhenNeeded = !c.answerable || answer.citations.length > 0;
  return {
    id: c.id,
    retrievalHit,
    answerableCorrect,
    factsFound,
    factsTotal: c.must_include.length,
    citations: answer.citations.length,
    pass: answerableCorrect && factsFound === c.must_include.length && citedWhenNeeded,
  };
}

export function summarize(results: CaseResult[]) {
  const scored = results.filter((r) => r.retrievalHit !== null);
  const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
  return {
    cases: results.length,
    passRate: pct(results.filter((r) => r.pass).length, results.length),
    retrievalHitRate: pct(scored.filter((r) => r.retrievalHit).length, scored.length),
    answerableAccuracy: pct(results.filter((r) => r.answerableCorrect).length, results.length),
    factRecall: pct(
      results.reduce((s, r) => s + r.factsFound, 0),
      results.reduce((s, r) => s + r.factsTotal, 0),
    ),
  };
}
