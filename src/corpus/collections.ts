import type { CorpusDoc, CorpusSection } from "../crawl/types.js";

/** The app's sections. Every chunk belongs to exactly one. */
export const COLLECTIONS = [
  { id: "funding", label: "Funding & Finance", blurb: "RSO funding boards, the Financial Manual, the Finance Code, purchasing, travel, receipts and budgets." },
  { id: "governance", label: "Constitution & Statutes", blurb: "The Student Body Constitution, the Statutes, Senate policies, and how SGA's branches work." },
  { id: "elections", label: "Elections & Judicial", blurb: "The Election Code, candidate rules, the Supervisor of Elections, and the Student Supreme Court." },
  { id: "agencies", label: "Agencies & Programs", blurb: "SGA agencies, bureaus, institutes, class councils, boards and projects." },
  { id: "cogs", label: "Graduate Students (COGS)", blurb: "The Congress of Graduate Students, its code and its funding." },
  { id: "meetings", label: "Meetings & Legislation", blurb: "Senate, COGS, funding board and agency meetings, agendas, minutes and bills." },
  { id: "resources", label: "Student Resources", blurb: "Legal and tax help, community resources, getting involved, and other FSU offices." },
] as const;

export type CollectionId = (typeof COLLECTIONS)[number]["id"];
export const COLLECTION_IDS = COLLECTIONS.map((c) => c.id) as readonly CollectionId[];

/** Statutes chapters by number: Title VII elections, VIII finance, IX-X agencies. */
export function collectionForChapter(chapter: number): CollectionId {
  if (chapter >= 700 && chapter < 800) return "elections";
  if (chapter >= 800 && chapter < 900) return "funding";
  if (chapter >= 900 && chapter < 1100) return "agencies";
  if (chapter >= 500 && chapter < 600) return "elections"; // Title V, the Judicial Branch
  return "governance";
}

function forPath(url: URL): CollectionId | null {
  const p = url.pathname.toLowerCase();
  if (url.host === "sai.fsu.edu") return "agencies";
  if (/accounting|funding|budget|financ|purchas|travel|reimburs/.test(p)) return "funding";
  if (/^\/cogs|graduate/.test(p)) return "cogs";
  if (/election|judicial|supreme-court|court/.test(p)) return "elections";
  if (/agenc|bureau|institute|projects-and-initiatives|affiliated|irhc|omhc|oga|class-council|union-board|rec-board|homecoming/.test(p)) return "agencies";
  if (/resources|get-involved|faq|legal|tax|community/.test(p)) return "resources";
  if (/legislat|minutes|agenda|senate\/bills|resolution/.test(p)) return "meetings";
  if (/student-government|about|executive|legislative|senate|constitution|statute/.test(p)) return "governance";
  return null;
}

/**
 * Picks the section for one part of a source. Code books are classified per chapter, because
 * one book (the Statutes) spans elections, finance and agencies.
 */
export function classify(doc: CorpusDoc, section: CorpusSection, parentCollection?: CollectionId | null): CollectionId {
  if (doc.kind === "meeting") return "meetings";
  if (doc.kind === "code") {
    const book = String(doc.meta?.book ?? "");
    const sub = String(doc.meta?.subBook ?? "").toUpperCase();
    if (book.includes("Graduate")) return "cogs";
    if (book.includes("Judicial") || book.includes("Election")) return "elections";
    if (book.includes("Union") || book.includes("Recreation") || book.includes("Executive")) return "agencies";
    if (sub.includes("BUDGET")) return "funding";
    if (sub.includes("LEGISLATION")) return "meetings";
    const chapter = section.heading.match(/^chapter\s+(\d+)/i);
    if (chapter) return collectionForChapter(Number(chapter[1]));
    return "governance";
  }
  const url = new URL(doc.url);
  if (doc.kind === "document") {
    if (url.host.includes("amazonaws.com") && url.pathname.includes("municipalcodeonline")) {
      return /budget/i.test(url.pathname) ? "funding" : "meetings";
    }
    return forPath(url) ?? parentCollection ?? "resources";
  }
  if (doc.meta?.scope === "one-hop") return forPath(url) ?? "resources";
  return forPath(url) ?? (url.pathname === "/" ? "governance" : "resources");
}
