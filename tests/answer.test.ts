import { describe, expect, it } from "vitest";
import { buildContext, finalizeAnswer, validateCitations } from "../src/answer.js";
import type { RetrievedChunk } from "../src/types.js";

const chunks: RetrievedChunk[] = [
  { id: 11, ordinal: 0, section: "LODGING", pageStart: 12, pageEnd: 12, similarity: 0.8, content: "Daily hotel rate should not exceed $225 per night (before tax). Each room is expected to host four travelers." },
  { id: 12, ordinal: 1, section: "Prohibited Purchases", pageStart: 10, pageEnd: 11, similarity: 0.6, content: "Food for meetings with under 10 attendees" },
];

describe("buildContext", () => {
  it("numbers excerpts with section and pages", () => {
    const ctx = buildContext(chunks);
    expect(ctx).toContain("[1] Section: LODGING (p. 12)");
    expect(ctx).toContain("[2] Section: Prohibited Purchases (pp. 10-11)");
  });
});

describe("validateCitations", () => {
  it("keeps a real quote and maps it to section and pages", () => {
    const out = validateCitations([{ excerpt: 1, quote: "should not exceed $225 per night" }], chunks);
    expect(out).toEqual([{ chunkId: 11, section: "LODGING", pages: "12", quote: "should not exceed $225 per night" }]);
  });

  it("drops quotes that are not in the excerpt (invented sources)", () => {
    expect(validateCitations([{ excerpt: 1, quote: "up to $300 per night" }], chunks)).toEqual([]);
  });

  it("drops citations to excerpts that do not exist", () => {
    expect(validateCitations([{ excerpt: 7, quote: "anything" }], chunks)).toEqual([]);
  });

  it("ignores whitespace and case differences", () => {
    expect(validateCitations([{ excerpt: 2, quote: "food  for MEETINGS with under 10" }], chunks)).toHaveLength(1);
  });
});

describe("finalizeAnswer", () => {
  it("downgrades a confident answer with no valid citation", () => {
    const out = finalizeAnswer({ answerable: true, answer: "Yes, $500.", citations: [{ excerpt: 1, quote: "made up" }] }, chunks);
    expect(out.answerable).toBe(false);
    expect(out.citations).toEqual([]);
  });

  it("passes through a supported answer", () => {
    const out = finalizeAnswer(
      { answerable: true, answer: "$225 per night, four per room.", citations: [{ excerpt: 1, quote: "four travelers" }] },
      chunks,
    );
    expect(out).toMatchObject({ answerable: true, answer: "$225 per night, four per room." });
    expect(out.citations).toHaveLength(1);
  });
});
