import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { loadEvalCases } from "../src/evals.js";
import { readPdfPages } from "../src/ingest/pdf.js";
import { chunkPages, parseTableOfContents } from "../src/ingest/chunk.js";

// Checks the eval set against the real manual, so a typo in a case can't make it
// impossible to pass. Needs data/26-27SGAFM.pdf (CI downloads it).
const manual = "data/26-27SGAFM.pdf";

describe.skipIf(!existsSync(manual))("eval set matches the manual", async () => {
  const pages = existsSync(manual) ? await readPdfPages(manual) : [];
  const toc = parseTableOfContents(pages);
  const chunks = toc ? chunkPages(pages, { headings: toc.headings, skipPages: [1, toc.tocPage] }) : [];
  const cases = (await loadEvalCases("evals/questions.jsonl")).filter((c) => c.answerable && c.expected_section);

  it.each(cases.map((c) => [c.id, c] as const))("%s: expected section exists and contains every required fact", (_id, c) => {
    const inSection = chunks.filter((ch) => ch.section.toLowerCase().includes(c.expected_section.toLowerCase()));
    expect(inSection.length, `no section matches "${c.expected_section}"`).toBeGreaterThan(0);
    const text = inSection.map((ch) => ch.content).join(" ").toLowerCase();
    for (const fact of c.must_include) expect(text, `"${fact}" not in ${c.expected_section}`).toContain(fact.toLowerCase());
  });
});
