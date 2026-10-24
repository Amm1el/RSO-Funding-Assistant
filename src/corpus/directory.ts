import type { CorpusDoc } from "../crawl/types.js";
import { classify, type CollectionId } from "./collections.js";

/** One office, position or person with a way to reach them. */
export interface Contact {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  collection: CollectionId;
  source: { title: string; url: string };
}

/** A place where SGA bodies meet, with who meets there. */
export interface Place {
  name: string;
  /** Meeting categories seen there, most frequent first, e.g. ["Student Senate", "COGS"]. */
  usedBy: string[];
  meetings: number;
  lastMeeting: string;
  /** Online links (Zoom, fla.st short links) are kept apart from rooms. */
  online: boolean;
}

/** A scheduled meeting that hasn't happened yet. */
export interface UpcomingMeeting {
  title: string;
  category: string;
  date: string;
  where?: string;
  url: string;
}

export interface Directory {
  contacts: Contact[];
  places: Place[];
  upcoming: UpcomingMeeting[];
  builtAt: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\(?\b(\d{3})\)?[\s.-]*(\d{3})[\s.-](\d{4})\b/;
/** FSU buildings and rooms as they're written on SGA pages ("Student Union 3268", "Room 3100"). */
const LOCATION =
  /\b((?:Oglesby\s+)?(?:Student\s+Union|SU)\s*(?:Room\s*|Suite\s*|#)?\d{3,4}[A-Z]?|(?:Room|Suite|Office)\s+\d{2,4}[A-Z]?(?:\s*,?\s*(?:Student Union|Askew|Strozier|HCB|Bellamy|Dirac|Diffenbaugh|Westcott|University Center|UCC)[A-Za-z ]*)?|(?:Askew Student Life Center|Strozier Library|University Center|Westcott Building|Senate Chambers|Moore Auditorium)[^.,\n]{0,25}|\d{2,4}\s+[NSEW]\.?\s+Woodward\s+Ave[^,\n]*)/i;
/** Lines that are only labels or contact details, never a name. */
const NOT_A_NAME = /^(email|e-mail|phone|tel|telephone|fax|location|office|address|hours|contact( us| information)?|website|room)\s*(:|$)|@|https?:|^\(?\d{3}\)?[\s.-]*\d{3}/i;

function cleanName(s: string): string {
  return s
    .replace(/\s*[|:–—-]\s*$/, "")
    .replace(/^(contact|email|reach out to|please contact)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function formatPhone(m: RegExpMatchArray) {
  return `(${m[1]}) ${m[2]}-${m[3]}`;
}

/**
 * Pulls contacts out of every page and document section: each email address becomes an
 * entry named by the text in front of it on the same line ("Student Body Treasurer:
 * SGA-SBT@fsu.edu"), or the nearest line above that isn't itself a contact detail, or the
 * section heading. Phones and rooms within two lines are attached to it.
 */
export function extractContacts(docs: CorpusDoc[]): Contact[] {
  const byEmail = new Map<string, Contact>();
  for (const doc of docs) {
    if (doc.kind === "meeting") continue;
    for (const section of doc.sections) {
      const lines = section.text.split("\n").map((l) => l.trim());
      lines.forEach((line, i) => {
        for (const match of line.matchAll(EMAIL)) {
          const email = match[0].replace(/[.,;:)]+$/, "").toLowerCase();
          if (/example\.|noreply|no-reply|\.(png|jpg)$/.test(email)) continue;
          const before = cleanName(line.slice(0, match.index).split(/[|•‣]/).map((p) => p.trim()).filter(Boolean).pop() ?? "");
          let name = before.length >= 3 && !NOT_A_NAME.test(before) ? before : "";
          for (let j = i - 1; !name && j >= Math.max(0, i - 3); j--) if (lines[j] && !NOT_A_NAME.test(lines[j]) && lines[j].length <= 90) name = cleanName(lines[j]);
          if (!name) name = section.heading || doc.title;
          const nearby = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
          const phone = nearby.match(PHONE);
          const location = nearby.match(LOCATION)?.[1]?.replace(/\s+/g, " ").trim();
          const existing = byEmail.get(email);
          const entry: Contact = existing ?? {
            name,
            email,
            collection: classify(doc, section),
            source: { title: doc.title, url: section.url ?? doc.url },
          };
          // Prefer the official sga.fsu.edu page as the source when the same email appears in several places.
          if (existing && !existing.source.url.includes("sga.fsu.edu") && doc.url.includes("sga.fsu.edu")) {
            entry.name = name;
            entry.source = { title: doc.title, url: section.url ?? doc.url };
          }
          entry.phone ??= phone ? formatPhone(phone) : undefined;
          entry.location ??= location;
          byEmail.set(email, entry);
        }
      });
    }
  }
  return [...byEmail.values()].sort((a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name));
}

/** Where meetings happen, from the meeting records' "Where:" lines. */
export function extractPlaces(docs: CorpusDoc[]): Place[] {
  const places = new Map<string, { name: string; uses: Map<string, number>; meetings: number; last: string; online: boolean }>();
  for (const doc of docs) {
    if (doc.kind !== "meeting") continue;
    const details = doc.sections.find((s) => s.heading === "Meeting details")?.text ?? "";
    const where = details.match(/^Where:\s*(.+)$/m)?.[1]?.trim();
    if (!where) continue;
    // "NSU 3rd Floor Project Room fla.st/sga-meet-rules" -> room and link are separate places.
    const parts = where.split(/,\s*|\s+(?=(?:https?:\/\/|fla\.st\/|[\w.-]+\.zoom\.us\/))/).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const online = /^(https?:\/\/|fla\.st\/|[\w.-]+\.zoom\.us)/i.test(part);
      const key = part.toLowerCase();
      const p = places.get(key) ?? { name: part, uses: new Map(), meetings: 0, last: "", online };
      const category = String(doc.meta?.category ?? "Other");
      p.uses.set(category, (p.uses.get(category) ?? 0) + 1);
      p.meetings++;
      const date = String(doc.meta?.date ?? "");
      if (date > p.last) p.last = date;
      places.set(key, p);
    }
  }
  return [...places.values()]
    .map((p) => ({ name: p.name, usedBy: [...p.uses].sort((a, b) => b[1] - a[1]).map(([c]) => c), meetings: p.meetings, lastMeeting: p.last, online: p.online }))
    .sort((a, b) => Number(a.online) - Number(b.online) || b.meetings - a.meetings);
}

/** Meetings dated after `now`, soonest first. */
export function extractUpcoming(docs: CorpusDoc[], now = new Date()): UpcomingMeeting[] {
  return docs
    .filter((d) => d.kind === "meeting" && String(d.meta?.date ?? "") > now.toISOString())
    .map((d) => {
      const details = d.sections.find((s) => s.heading === "Meeting details")?.text ?? "";
      return {
        title: d.title.replace(/\s*\([^)]*\d{4}\)$/, ""),
        category: String(d.meta?.category ?? ""),
        date: String(d.meta?.date),
        where: details.match(/^Where:\s*(.+)$/m)?.[1]?.trim(),
        url: d.url,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildDirectory(docs: CorpusDoc[]): Directory {
  return { contacts: extractContacts(docs), places: extractPlaces(docs), upcoming: extractUpcoming(docs), builtAt: new Date().toISOString() };
}
