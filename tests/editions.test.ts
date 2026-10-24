import { describe, expect, it } from "vitest";
import { diffEditions, editionChanges } from "../src/corpus/editions.js";
import type { CorpusDoc } from "../src/crawl/types.js";

const header = "Registered Student Organization Financial Manual 2026-2027";
const doc = (url: string, pages: string[]): CorpusDoc => ({
  id: url, url, title: "Financial Manual", kind: "document", host: "sga.fsu.edu", fetchedAt: "2026-10-24",
  sections: pages.map((text, i) => ({ heading: `Page ${i + 1}`, page: i + 1, text: `${header}\n${text}\n${i + 1}` })),
});
const filler = (n: number) => Array.from({ length: 30 }, (_, i) => `Rule ${n}-${i} applies to every registered organization on campus.`).join(" ");
const base = [filler(1), filler(2), filler(3), filler(4)];
const oldEd = doc("https://sga.fsu.edu/26-27SGAFM.pdf", [...base, "Travel covers registration, lodging, airfare, and mileage only. RSOs are not eligible for Uber or Lyft reimbursement."]);
const newEd = doc("https://sga.fsu.edu/26-27SGAFM-updated-9.21.26.pdf", [...base, "Travel covers registration, lodging, airfare, and transportation only."]);

describe("edition changes", () => {
  it("reports reworded and removed rules, not running headers or page numbers", () => {
    const { added, removed } = diffEditions(oldEd, newEd);
    expect(added).toEqual(["Travel covers registration, lodging, airfare, and transportation only."]);
    expect(removed).toEqual(["Travel covers registration, lodging, airfare, and mileage only.", "RSOs are not eligible for Uber or Lyft reimbursement."]);
  });
  it("pairs editions through near-duplicate detection, newest as the new edition", () => {
    const [c] = editionChanges([oldEd, newEd]);
    expect(c.newUrl).toContain("updated");
    expect(c.oldUrl).toBe("https://sga.fsu.edu/26-27SGAFM.pdf");
  });
});
