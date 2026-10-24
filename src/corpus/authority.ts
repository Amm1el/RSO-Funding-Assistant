import type { CorpusDoc } from "../crawl/types.js";

/**
 * How much a source should count when several answer the same question. Governing text
 * (code books, the current manual, SGA's own pages) outranks history (old budgets, past
 * minutes, the bills that amended the statutes), and the current academic year outranks
 * past ones. Applied as a multiplier on the fused retrieval score.
 */
export function sourceWeight(doc: CorpusDoc, now = new Date()): number {
  if (doc.kind === "code") return 1;
  if (doc.kind === "page") return doc.meta?.scope === "one-hop" ? 0.6 : 0.9;
  if (doc.kind === "meeting") {
    const date = new Date(String(doc.meta?.date ?? 0)).getTime();
    return now.getTime() - date < 60 * 86400_000 ? 0.75 : 0.4;
  }
  // Documents
  const url = decodeURIComponent(doc.url);
  if (url.includes("municipalcodeonline")) return 0.35; // historical bills and resolutions
  if (/minutes|agenda/i.test(url + doc.title)) return 0.4;
  const year = latestAcademicYear(`${doc.title} ${url} ${doc.sections[0]?.text.slice(0, 400) ?? ""}`);
  const current = currentAcademicYear(now);
  if (year === null) return 0.75;
  if (year >= current) return 1;
  return year === current - 1 ? 0.55 : 0.45;
}

/** FSU's academic year starts in August: October 2026 is in 2026-27, so this returns 2026. */
export function currentAcademicYear(now = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * The latest academic year a text refers to, as its starting year: "2026-2027", "26-27",
 * "2026-27" and "FY27" all give 2026. Plain years count as the year they start ("2025" -> 2025).
 */
export function latestAcademicYear(text: string): number | null {
  const years: number[] = [];
  for (const m of text.matchAll(/\b(20\d{2})\s*[-–/]\s*(20)?(\d{2})\b/g)) {
    const start = Number(m[1]);
    const end = Number(`20${m[3]}`);
    if (end === start + 1) years.push(start);
  }
  for (const m of text.matchAll(/(?<![\d.])(\d{2})\s*-\s*(\d{2})(?=\s*SGAFM|\s*[A-Z_ -]*(?:manual|budget|SGAFM))/gi)) {
    if (Number(m[2]) === Number(m[1]) + 1) years.push(2000 + Number(m[1]));
  }
  for (const m of text.matchAll(/\bFY\s?(\d{2})\b/gi)) years.push(2000 + Number(m[1]) - 1);
  if (!years.length) for (const m of text.matchAll(/\b(20[12]\d)\b/g)) years.push(Number(m[1]));
  const plausible = years.filter((y) => y >= 2000 && y <= 2100);
  return plausible.length ? Math.max(...plausible) : null;
}

const GENERIC_LINK = /^(here|click here|download|link|view|pdf|read more|more|this|document|form|file|updated .* here|.* here)$/i;

/**
 * A readable title for a document. Link text is often generic ("here", "updated financial
 * manual here"), so fall back to the document's first heading-like line, then its file name.
 */
export function betterTitle(doc: CorpusDoc): string {
  if (doc.kind !== "document") return doc.title;
  const link = doc.title.trim();
  const words = link.split(/\s+/).length;
  if (link && !GENERIC_LINK.test(link) && words >= 3 && !/^microsoft word/i.test(link)) return link;
  const first = (doc.sections[0]?.text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && /[a-z]/i.test(l) && !/^page \d+|^\d+$/i.test(l))
    .slice(0, 3)
    .join(" ")
    .replace(/\s+/g, " ");
  const fromFile = decodeURIComponent(new URL(doc.url).pathname.split("/").pop() ?? "")
    .replace(/\.(pdf|docx)$/i, "")
    .replace(/^\d{9,}_/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  const candidate = first.length >= 8 && first.length <= 110 ? titleCase(first) : fromFile || link;
  // Keep version hints from the file name, so two editions don't share a title.
  const updated = fromFile.match(/updated\s+([\d.]+)/i);
  return updated && !/updated/i.test(candidate) ? `${candidate} (updated ${updated[1].replace(/\.$/, "")})` : candidate;
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Sga|Rso|Cogs|Fsu|Rsoac|A&s)\b/g, (m) => m.toUpperCase());
}

/** Word 5-shingles of a document, hashed, for near-duplicate detection. */
function shingles(doc: CorpusDoc): Set<string> {
  const words = doc.sections.map((s) => s.text).join(" ").toLowerCase().split(/\W+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 5 <= words.length; i += 2) out.add(words.slice(i, i + 5).join(" "));
  return out;
}

/**
 * Drops documents that are near-copies of another (e.g. two editions of the manual linked
 * from different pages), keeping the newest: higher academic year, then "updated" in the
 * name, then the longer one. Only compares documents of similar length, so it stays fast.
 */
export function dropNearDuplicates(docs: CorpusDoc[], threshold = 0.8): { kept: CorpusDoc[]; dropped: { doc: CorpusDoc; keptUrl: string }[] } {
  const candidates = docs.filter((d) => d.kind === "document");
  const info = candidates.map((d) => {
    const s = shingles(d);
    return { d, s, size: s.size, year: latestAcademicYear(`${d.title} ${decodeURIComponent(d.url)}`) ?? 0, updated: /updated/i.test(d.url) };
  });
  info.sort((a, b) => b.year - a.year || Number(b.updated) - Number(a.updated) || b.size - a.size);
  const keptInfo: typeof info = [];
  const dropped: { doc: CorpusDoc; keptUrl: string }[] = [];
  for (const cur of info) {
    if (cur.size < 40) {
      keptInfo.push(cur);
      continue;
    }
    const twin = keptInfo.find((k) => {
      if (k.size < 40 || Math.min(k.size, cur.size) / Math.max(k.size, cur.size) < threshold) return false;
      let shared = 0;
      for (const sh of cur.s) if (k.s.has(sh)) shared++;
      return shared / Math.min(k.size, cur.size) >= threshold;
    });
    if (twin) dropped.push({ doc: cur.d, keptUrl: twin.d.url });
    else keptInfo.push(cur);
  }
  const droppedSet = new Set(dropped.map((x) => x.doc));
  return { kept: docs.filter((d) => !droppedSet.has(d)), dropped };
}
