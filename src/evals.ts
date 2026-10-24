import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Answer, RetrievedChunk } from "./types.js";

export const EvalCase = z.object({
  id: z.string(),
  question: z.string(),
  /** False for questions the manual doesn't answer; the right behavior is to refuse. */
  answerable: z.boolean(),
  /** Substring of the section label the answer lives in; empty means "don't score retrieval or citations". */
  expected_section: z.string(),
  /** Facts the answer must mention (case-insensitive substring match). */
  must_include: z.array(z.string()),
  /** The correct answer in plain words, used by the optional LLM judge. */
  reference_answer: z.string().optional(),
  /** lookup = one fact; number = a limit, amount or deadline; multi = needs several facts; refuse = not in the manual. */
  category: z.enum(["lookup", "number", "multi", "refuse"]).optional(),
  /** The app section a user would ask this in; the eval searches only that section unless --collection all. */
  collection: z.string().optional(),
  /** Where the case came from, e.g. "manual" (drafted from the text) or "rsoac-inbox" (a real question, paraphrased). */
  origin: z.string().optional(),
  /** True once a person who knows the rules (the RSOAC chair) has checked the case. */
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
  answerable: boolean;
  /** 1-based rank of the first retrieved passage from the expected section; null = not found or not scored. */
  retrievalRank: number | null;
  /** Did the expected section come back at all? null when the case has no expected section. */
  retrievalHit: boolean | null;
  /** Does at least one citation point at the expected section? null when not scored. */
  citationCorrect: boolean | null;
  answerableCorrect: boolean;
  factsFound: number;
  factsTotal: number;
  citations: number;
  /** LLM judge verdict against the reference answer, when the judge ran. */
  judgeCorrect?: boolean;
  pass: boolean;
}

const includesSection = (section: string, expected: string) => section.toLowerCase().includes(expected.toLowerCase());

/** Scores one case with deterministic checks (no LLM involved). */
export function scoreCase(c: EvalCase, retrieved: RetrievedChunk[], answer: Answer): CaseResult {
  const scoreSections = c.answerable && c.expected_section !== "";
  const rankIndex = scoreSections ? retrieved.findIndex((r) => includesSection(r.section, c.expected_section)) : -1;
  const retrievalRank = rankIndex >= 0 ? rankIndex + 1 : null;
  const citationCorrect = scoreSections ? answer.citations.some((cit) => includesSection(cit.section, c.expected_section)) : null;

  const text = answer.answer.toLowerCase();
  const factsFound = c.must_include.filter((f) => text.includes(f.toLowerCase())).length;
  const answerableCorrect = answer.answerable === c.answerable;
  const citedWhenNeeded = !c.answerable || (answer.citations.length > 0 && citationCorrect !== false);

  return {
    id: c.id,
    answerable: c.answerable,
    retrievalRank,
    retrievalHit: scoreSections ? retrievalRank !== null : null,
    citationCorrect,
    answerableCorrect,
    factsFound,
    factsTotal: c.must_include.length,
    citations: answer.citations.length,
    pass: answerableCorrect && factsFound === c.must_include.length && citedWhenNeeded,
  };
}

export interface Summary {
  cases: number;
  /** % of cases that pass every check. The headline number. */
  passRate: number;
  /** % of answerable cases where the expected section was retrieved. */
  retrievalHitRate: number;
  /** Mean reciprocal rank of the expected section (1.0 = always first). */
  mrr: number;
  /** % of answerable cases whose citations include the expected section. */
  citationAccuracy: number;
  /** % of answerable questions that were answered. */
  answerRate: number;
  /** % of unanswerable questions that were correctly refused. */
  refusalRate: number;
  /** % of required facts that appeared in answers. */
  factRecall: number;
  /** % judged correct by the LLM judge, when it ran. */
  judgeAccuracy?: number;
}

export function summarize(results: CaseResult[]): Summary {
  const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
  const retrievalScored = results.filter((r) => r.retrievalHit !== null);
  const citationScored = results.filter((r) => r.citationCorrect !== null);
  const answerable = results.filter((r) => r.answerable);
  const unanswerable = results.filter((r) => !r.answerable);
  const judged = results.filter((r) => r.judgeCorrect !== undefined);
  const mrr = retrievalScored.length
    ? retrievalScored.reduce((s, r) => s + (r.retrievalRank ? 1 / r.retrievalRank : 0), 0) / retrievalScored.length
    : 0;
  return {
    cases: results.length,
    passRate: pct(results.filter((r) => r.pass).length, results.length),
    retrievalHitRate: pct(retrievalScored.filter((r) => r.retrievalHit).length, retrievalScored.length),
    mrr: Math.round(mrr * 100) / 100,
    citationAccuracy: pct(citationScored.filter((r) => r.citationCorrect).length, citationScored.length),
    answerRate: pct(answerable.filter((r) => r.answerableCorrect).length, answerable.length),
    refusalRate: pct(unanswerable.filter((r) => r.answerableCorrect).length, unanswerable.length),
    factRecall: pct(
      results.reduce((s, r) => s + r.factsFound, 0),
      results.reduce((s, r) => s + r.factsTotal, 0),
    ),
    ...(judged.length ? { judgeAccuracy: pct(judged.filter((r) => r.judgeCorrect).length, judged.length) } : {}),
  };
}
