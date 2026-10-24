import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { loadEvalCases } from "../src/evals.js";
import { DEFAULT_CORPUS_DIR, loadCorpus, manualAsDoc } from "../src/corpus/load.js";
import { docToChunks } from "../src/corpus/chunk.js";
import type { CorpusDoc } from "../src/crawl/types.js";

// Checks the funding eval cases against the current Financial Manual, so a typo (or a rule
// the manual has since changed) can't silently make a case impossible to pass. Uses the
// crawled current edition when data/corpus exists (CI pulls it), else the local PDF.
const CURRENT = /26-27SGAFM-updated[^/]*\.pdf$/;
const LOCAL_PDF = "data/26-27SGAFM.pdf";

async function currentManual(): Promise<CorpusDoc | null> {
  const fromCorpus = (await loadCorpus(DEFAULT_CORPUS_DIR)).find((d) => CURRENT.test(d.url));
  if (fromCorpus) return fromCorpus;
  return existsSync(LOCAL_PDF) ? manualAsDoc(LOCAL_PDF) : null;
}

const manual = await currentManual();

describe.skipIf(!manual)(`eval set matches the manual (${manual ? manual.url.split("/").pop() : "none"})`, async () => {
  const chunks = manual ? docToChunks(manual).chunks : [];
  const cases = (await loadEvalCases("evals/questions.jsonl")).filter((c) => c.answerable && c.expected_section && !c.collection);

  it.each(cases.map((c) => [c.id, c] as const))("%s: expected section exists and contains every required fact", (_id, c) => {
    const inSection = chunks.filter((ch) => ch.section.toLowerCase().includes(c.expected_section.toLowerCase()));
    expect(inSection.length, `no section matches "${c.expected_section}"`).toBeGreaterThan(0);
    const text = inSection.map((ch) => ch.content).join(" ").toLowerCase();
    for (const fact of c.must_include) expect(text, `"${fact}" not in ${c.expected_section}`).toContain(fact.toLowerCase());
  });
});
