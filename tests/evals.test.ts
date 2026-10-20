import { describe, expect, it } from "vitest";
import { loadEvalCases, scoreCase, summarize } from "../src/evals.js";
import type { RetrievedChunk } from "../src/types.js";

const lodging: RetrievedChunk = { id: 1, ordinal: 0, section: "LODGING", pageStart: 12, pageEnd: 12, similarity: 0.7, content: "..." };

describe("eval set", () => {
  it("parses and has unique ids", async () => {
    const cases = await loadEvalCases("evals/questions.jsonl");
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.some((c) => !c.answerable)).toBe(true);
  });
});

describe("scoreCase", () => {
  const c = { id: "hotel", question: "q", answerable: true, expected_section: "LODGING", must_include: ["225", "four"], verified: false };

  it("passes when facts, citations and answerability all line up", () => {
    const r = scoreCase(c, [lodging], { answerable: true, answer: "Up to $225 a night, four per room.", citations: [{ chunkId: 1, section: "LODGING", pages: "12", quote: "x" }] });
    expect(r).toMatchObject({ pass: true, retrievalHit: true, factsFound: 2 });
  });

  it("fails an answer without citations", () => {
    const r = scoreCase(c, [lodging], { answerable: true, answer: "Up to $225 a night, four per room.", citations: [] });
    expect(r.pass).toBe(false);
  });

  it("summarizes rates", () => {
    const r = scoreCase(c, [], { answerable: false, answer: "", citations: [] });
    expect(summarize([r])).toMatchObject({ cases: 1, passRate: 0, retrievalHitRate: 0, answerableAccuracy: 0 });
  });
});
