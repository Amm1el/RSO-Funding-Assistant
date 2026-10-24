import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CorpusDoc } from "../crawl/types.js";
import { readPdfPages } from "../ingest/pdf.js";

export const DEFAULT_CORPUS_DIR = "data/corpus";
export const MANUAL_URL = "https://sga.fsu.edu/sites/default/files/PDFs/Accounting/26-27SGAFM.pdf";

/** Reads every <source>.jsonl the crawler wrote. */
export async function loadCorpus(dir = DEFAULT_CORPUS_DIR): Promise<CorpusDoc[]> {
  if (!existsSync(dir)) return [];
  const docs: CorpusDoc[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort()) {
    for (const line of (await readFile(join(dir, file), "utf8")).split("\n")) if (line.trim()) docs.push(JSON.parse(line));
  }
  return docs;
}

/** A local PDF of the Financial Manual as a corpus document (used when no crawl is available). */
export async function manualAsDoc(file: string): Promise<CorpusDoc> {
  const pages = await readPdfPages(file);
  return {
    id: "local-manual",
    url: MANUAL_URL,
    title: "2026-27 RSO Financial Manual",
    kind: "document",
    host: "sga.fsu.edu",
    fetchedAt: new Date().toISOString(),
    sections: pages.map((text, i) => ({ heading: `Page ${i + 1}`, page: i + 1, text })).filter((s) => s.text.trim()),
    meta: { file: basename(file) },
  };
}
