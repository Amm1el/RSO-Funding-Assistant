import { describe, expect, it } from "vitest";
import { chunkPages, editDistance, joinLines, matchHeading, normalizeHeading, parseTableOfContents } from "../src/ingest/chunk.js";

const toc = [
  "Cover",
  ["Table of Contents", "Funding Options.......... 3", "Regestered Student Organization Allocation Committee (RSOAC)......3", "LODGING.............. 4"].join("\n"),
];

describe("parseTableOfContents", () => {
  it("reads headings and the TOC page", () => {
    const parsed = parseTableOfContents(toc)!;
    expect(parsed.tocPage).toBe(2);
    expect(parsed.headings).toEqual([
      "Funding Options",
      "Regestered Student Organization Allocation Committee (RSOAC)",
      "LODGING",
    ]);
  });

  it("returns null when there is no TOC", () => {
    expect(parseTableOfContents(["just text"])).toBeNull();
  });
});

describe("heading matching", () => {
  const headings = new Map(
    ["Funding Options", "Regestered Student Organization Allocation Committee (RSOAC)", "InternationalTravel"].map((h) => [normalizeHeading(h), h]),
  );

  it("matches despite punctuation and spacing", () => {
    expect(matchHeading("International Travel", headings)).toBe("InternationalTravel");
  });

  it("tolerates a typo in the table of contents", () => {
    expect(matchHeading("Registered Student Organization Allocation Committee (RSOAC)", headings)).toBeDefined();
  });

  it("does not treat body sentences as headings", () => {
    expect(matchHeading("Funding options are listed below for every RSO on campus.", headings)).toBeUndefined();
  });

  it("computes edit distance", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("chunkPages", () => {
  const pages = [
    "Cover page",
    "Table of Contents\nIntro........ 3\nTravel........ 3",
    [
      "Intro",
      "Welcome to the manual.",
      "Registered Student Organization Financial Manual 2026-2027 3",
      "Travel",
      Array.from({ length: 120 }, (_, i) => `word${i}`).join(" "),
    ].join("\n"),
  ];
  const { headings, tocPage } = parseTableOfContents(pages)!;
  const chunks = chunkPages(pages, { headings, skipPages: [1, tocPage], maxWords: 50, overlapWords: 10 });

  it("never mixes sections in one chunk", () => {
    expect(chunks[0]).toMatchObject({ section: "Intro", content: "Welcome to the manual." });
    expect(chunks.slice(1).every((c) => c.section === "Travel")).toBe(true);
  });

  it("drops the running footer", () => {
    expect(chunks.some((c) => c.content.includes("Financial Manual 2026-2027"))).toBe(false);
  });

  it("overlaps windows inside a long section", () => {
    const travel = chunks.filter((c) => c.section === "Travel");
    expect(travel.length).toBe(3); // 120 words, windows of 50 with step 40
    expect(travel[1].content.startsWith("word40")).toBe(true);
    expect(travel[0].content.endsWith("word49")).toBe(true);
  });

  it("records page numbers and sequential ordinals", () => {
    expect(chunks.every((c) => c.pageStart === 3 && c.pageEnd === 3)).toBe(true);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("prefixes a child section with its parent when the parent has no body text", () => {
    const nested = [
      "Cover",
      "Table of Contents\nFinancial Certification.... 3\nRequirements.... 3\nFinal Notes.... 3",
      "Financial Certification\nRequirements\nAll officers must certify.\nFinal Notes\nThanks.",
    ];
    const parsed = parseTableOfContents(nested)!;
    const out = chunkPages(nested, { headings: parsed.headings, skipPages: [1, parsed.tocPage] });
    expect(out.map((c) => c.section)).toEqual(["Financial Certification: Requirements", "Final Notes"]);
  });

  it("rejects overlap that would never advance", () => {
    expect(() => chunkPages(pages, { maxWords: 10, overlapWords: 10 })).toThrow();
  });
});

describe("joinLines", () => {
  it("rejoins a word the PDF hyphenated across lines, and spaces everything else", () => {
    expect(joinLines(["email SGA-", "SBT@fsu.edu with", "questions"])).toBe("email SGA-SBT@fsu.edu with questions");
    expect(joinLines(["within 3-5", "business days"])).toBe("within 3-5 business days");
  });
});
