import { describe, expect, it } from "vitest";
import { loadEvalCases, scoreCase, summarize, type EvalCase } from "../src/evals.js";
import type { RetrievedChunk } from "../src/types.js";

const chunk = (id: number, section: string): RetrievedChunk => ({ id, ordinal: id, section, pageStart: 12, pageEnd: 12, similarity: 0.7, content: "..." });
const lodging = chunk(1, "LODGING");
const travel = chunk(2, "Travel Policies & Procedures: General Requirements");
const cite = (section: string) => ({ chunkId: 1, section, pages: "12", quote: "x" });

describe("eval set", () => {
  it("parses, has unique ids, at least 30 cases, and some the manual can't answer", async () => {
    const cases = await loadEvalCases("evals/questions.jsonl");
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.filter((c) => !c.answerable).length).toBeGreaterThanOrEqual(5);
  });
});

describe("scoreCase", () => {
  const c: EvalCase = { id: "hotel", question: "q", answerable: true, expected_section: "LODGING", must_include: ["225", "four"], verified: false };

  it("passes when facts, citations and answerability all line up", () => {
    const r = scoreCase(c, [travel, lodging], { answerable: true, answer: "Up to $225 a night, four per room.", citations: [cite("LODGING")] });
    expect(r).toMatchObject({ pass: true, retrievalHit: true, retrievalRank: 2, citationCorrect: true, factsFound: 2 });
  });

  it("fails an answer without citations", () => {
    const r = scoreCase(c, [lodging], { answerable: true, answer: "Up to $225 a night, four per room.", citations: [] });
    expect(r.pass).toBe(false);
  });

  it("fails an answer that cites the wrong section, even with the right facts", () => {
    const r = scoreCase(c, [lodging, travel], { answerable: true, answer: "$225, four per room.", citations: [cite(travel.section)] });
    expect(r).toMatchObject({ citationCorrect: false, pass: false });
  });

  it("passes a correct refusal and does not score its retrieval", () => {
    const refuse: EvalCase = { ...c, answerable: false, expected_section: "", must_include: [] };
    const r = scoreCase(refuse, [lodging], { answerable: false, answer: "Not covered.", citations: [] });
    expect(r).toMatchObject({ pass: true, retrievalHit: null, citationCorrect: null });
  });

  it("summarizes rates, including MRR and refusal rate", () => {
    const hit = scoreCase(c, [travel, lodging], { answerable: true, answer: "$225, four", citations: [cite("LODGING")] });
    const miss = scoreCase(c, [], { answerable: false, answer: "", citations: [] });
    const refused = scoreCase({ ...c, id: "r", answerable: false, expected_section: "", must_include: [] }, [], { answerable: false, answer: "", citations: [] });
    expect(summarize([hit, miss, refused])).toMatchObject({
      cases: 3,
      passRate: 67,
      retrievalHitRate: 50,
      mrr: 0.25,
      citationAccuracy: 50,
      answerRate: 50,
      refusalRate: 100,
    });
  });
});
