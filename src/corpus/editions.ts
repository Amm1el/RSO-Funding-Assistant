import type { CorpusDoc } from "../crawl/types.js";
import { dropNearDuplicates } from "./authority.js";
import { sentences } from "../extractive.js";
import { boilerplateKey, detectBoilerplate, joinLines } from "../ingest/chunk.js";

/** What changed between two editions of the same document. */
export interface EditionChange {
  title: string;
  newUrl: string;
  oldUrl: string;
  added: string[];
  removed: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%]+/g, " ").trim();

/** Words two sentences share, over the longer one's length: 1 = same, 0 = unrelated. */
function similarity(a: string, b: string): number {
  const wa = new Set(norm(a).split(" ")), wb = new Set(norm(b).split(" "));
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size, 1);
}

/**
 * Sentence-level diff of two editions. A sentence only counts as added (or removed) if no
 * sentence in the other edition is nearly the same, so re-wrapped lines and page headers
 * don't show up as changes; a reworded rule shows up as one removed + one added sentence.
 */
export function diffEditions(oldDoc: CorpusDoc, newDoc: CorpusDoc): Pick<EditionChange, "added" | "removed"> {
  const split = (d: CorpusDoc) => {
    // Running headers/footers and bare page numbers move between editions; drop them first.
    const pages = d.sections.map((s) => s.text);
    const boiler = pages.length >= 4 ? detectBoilerplate(pages) : new Set<string>();
    const body = pages.map((p) =>
      joinLines(p.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^\d{1,3}$/.test(l) && !boiler.has(boilerplateKey(l)))),
    );
    // One stream of text, so a sentence split across a page break isn't counted as changed.
    return [...new Set(sentences(body.join(" ").replace(/\s+/g, " ")))];
  };
  const oldS = split(oldDoc), newS = split(newDoc);
  const oldSet = new Set(oldS.map(norm)), newSet = new Set(newS.map(norm));
  const unmatched = (from: string[], other: string[], otherSet: Set<string>) =>
    from.filter((s) => !otherSet.has(norm(s)) && !other.some((o) => similarity(s, o) >= 0.9 || (norm(s).length > 25 && norm(o).includes(norm(s)))));
  return { added: unmatched(newS, oldS, oldSet), removed: unmatched(oldS, newS, newSet) };
}

/**
 * Documents whose edits change the rules: manuals, policies, guides, codes. Ledgers and
 * letters also come in "editions" (a balance sheet re-posted weekly) but their diffs are noise.
 */
const RULEBOOK = /manual|polic(y|ies)|guide|handbook|rules|procedure|bylaws|constitution|statute|code\b|packet|requirements|instructions/i;
const LEDGER = /balance sheet|ledger|letter|memo|minutes|agenda|bill\b|resolution|statement/i;

/** Changes for every rulebook that has an older edition in the corpus. */
export function editionChanges(docs: CorpusDoc[]): EditionChange[] {
  const byUrl = new Map(docs.map((d) => [d.url, d]));
  const { dropped } = dropNearDuplicates(docs);
  return dropped
    .map(({ doc: oldDoc, keptUrl }) => {
      const newDoc = byUrl.get(keptUrl)!;
      return { title: newDoc.title, newUrl: newDoc.url, oldUrl: oldDoc.url, ...diffEditions(oldDoc, newDoc) };
    })
    .filter((c) => (c.added.length || c.removed.length) && RULEBOOK.test(c.title + " " + decodeURIComponent(c.newUrl)) && !LEDGER.test(c.title + " " + decodeURIComponent(c.newUrl)));
}

export function changesMarkdown(changes: EditionChange[]): string {
  if (!changes.length) return "No document changed between editions.\n";
  return changes
    .map((c) => [`### ${c.title}`, `[new](${c.newUrl}) vs. [old](${c.oldUrl})`, "", ...c.added.map((s) => `- **Added:** ${clip(s)}`), ...c.removed.map((s) => `- ~~Removed:~~ ${clip(s)}`), ""].join("\n"))
    .join("\n");
}

const clip = (s: string) => (s.length > 300 ? `${s.slice(0, 297)}...` : s);
