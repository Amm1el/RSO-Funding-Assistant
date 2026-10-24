import type { CorpusDoc } from "../crawl/types.js";
import { classify, type CollectionId } from "./collections.js";
import { editionChanges, type EditionChange } from "./editions.js";

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
  /** Rule changes between editions of the same document (e.g. the manual's 9/21/26 update). */
  changes: EditionChange[];
  builtAt: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\(?\b(\d{3})\)?[\s.-]*(\d{3})[\s.-](\d{4})\b/;
/** FSU buildings and rooms as they're written on SGA pages ("Student Union 3268", "Room 3100"). */
const LOCATION =
  /\b((?:Oglesby\s+)?(?:Student\s+Union|SU)\s*(?:Room\s*|Suite\s*|#)?\d{3,4}[A-Z]?|(?:Room|Suite|Office)\s+\d{2,4}[A-Z]?(?:\s*,?\s*(?:Student Union|Askew|Strozier|HCB|Bellamy|Dirac|Diffenbaugh|Westcott|University Center|UCC)[A-Za-z ]*)?|(?:Askew Student Life Center|Strozier Library|University Center|Westcott Building|Senate Chambers|Moore Auditorium)[^.,\n]{0,25}|\d{2,4}\s+[NSEW]\.?\s+Woodward\s+Ave[^,\n]*)/i;
/** Lines that are only labels or contact details, never a name. */
const NOT_A_NAME = /^(email|e-mail|phone|tel|telephone|call|text|fax|location|office|address|hours|contact( us| information)?|general contact|website|room|read more|apply now|learn more|public notice|upcoming events|emplid|tallahassee|florida state university room)\b|^[–—-]|@|https?:|^\(?\d{3}\)?[\s.-]*\d{3}/i;

/** Text that reads like part of a sentence ("Email your slides to"), not the name of an office or role. */
const SENTENCE = /^page \d+$|^(sent|from|to|cc)\s*:|[(<]$|^or\b|\b(is|are|to|at|or|your|please|send|email|at:)$|^(if|for|the official|questions)\b/i;

/**
 * Inboxes whose role is plain from the address and SGA's own pages. Labeling them by role
 * (rather than "Treasurer • <this year's name>") keeps the directory right after elections.
 */
const ROLE_INBOXES: Record<string, string> = {
  "sga-sbp": "Student Body President",
  "sga-sbvp": "Student Body Vice President",
  "sga-sbt": "Student Body Treasurer",
  "sga-cos": "Student Body President's Chief of Staff",
  "sga-vpcos": "Student Body Vice President's Chief of Staff",
  "sga-attorneygeneral": "Attorney General",
  "sga-attorney-general": "Attorney General",
  "sga-senatepresident": "Student Senate President",
  "sga-senatepres": "Student Senate President",
  "sga-senateprotem": "Student Senate President Pro Tempore",
  "sga-senatepresprotem": "Student Senate President Pro Tempore",
  "sgasenateprotem": "Student Senate President Pro Tempore",
  "sga-senateclerk": "Senate Clerk",
  "sga-senatehistorian": "Senate Historian",
  "sga-senateparliamentarian": "Senate Parliamentarian",
  "sga-senatepublicaffairs": "Senate Public Affairs",
  "sga-senatetech": "Senate Technology Officer",
  "sga-rsoac": "RSO Allocation Committee (RSOAC)",
  "sgaaccounting": "SGA Accounting Office",
  "sgaelect": "Supervisor of Elections",
  "sgasupremecourt": "Student Supreme Court",
  "sga-court-clerk": "Clerk of the Court",
  "sga-cogsspeaker": "COGS Speaker",
  "cogsspeaker": "COGS Speaker",
  "cogsdepspeaker": "COGS Deputy Speaker",
  "sga-cogs-grants": "COGS Grants",
  "sga-cogsfinance": "COGS Finance",
  "sga-cogsjudicial": "COGS Judicial",
  "sga-cogsadvocacy": "COGS Deputy Speaker for Advocacy",
  "sga-cogs-communication": "COGS Deputy Speaker for Communication",
  "sga-class-councils": "Class Councils",
  "sga-pac": "Programming Allocations Committee (PAC)",
  "sga-press": "SGA Press",
  "sga-press-secretary": "SGA Press Secretary",
  "union-board": "Union Board",
  "victims-advocate": "Victim Advocate Program",
  "sai-bsu": "Black Student Union",
  "sai-bsuhouse": "Black Student Union House",
  "sai-wsu": "Women Student Union",
  "sai-jsu": "Jewish Student Union",
  "sai-psu": "Pride Student Union",
  "sai-aasu": "Asian American Student Union",
  "sai-hlsu": "Hispanic/Latinx Student Union",
  "sai-vsu": "Veterans Student Union",
};

function cleanName(s: string): string {
  return s
    .replace(/^[\s■□●○◦•‣▪▫·*>-]+/, "")
    .replace(/\s*[|:–—-]\s*$/, "")
    .replace(/^.*?\b(?:contact|email|reach out to|questions to)\s+(?:the\s+)?/i, "")
    .replace(/\s+(?:at|via|by email)\s*:?$/i, "")
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
    // Minutes and agendas mention addresses in passing; the directory wants published contacts.
    if (doc.kind === "meeting" || /minutes|agenda/i.test(doc.url + doc.title)) continue;
    for (const section of doc.sections) {
      const lines = section.text.split("\n").map((l) => l.trim());
      lines.forEach((line, i) => {
        for (const match of line.matchAll(EMAIL)) {
          const email = match[0].replace(/[.,;:)]+$/, "").toLowerCase();
          // FSU addresses only: office and position inboxes, not personal accounts.
          if (!/@([a-z0-9-]+\.)*fsu\.edu$/.test(email) || /example\.|noreply|no-reply|docusign/.test(email)) continue;
          // Student accounts (FSUIDs like abc23 / abc23x, and @my.fsu.edu) are people, not offices: leave them out.
          if (/@my\.fsu\.edu$/.test(email) || /^[a-z]{2,4}\d{2}[a-z]?@/.test(email)) continue;
          // Keep office and position inboxes (sga-sbt@, sai-wsu@, cogsdepspeaker@, victims-advocate@):
          // they outlast whoever holds the role, and the directory isn't a list of people.
          if (!/^(sga|sai|cogs|fsusga)|-/.test(email)) continue;
          // Forwarded-email headers in scanned packets ("From: ... <x@fsu.edu>").
          if (/^(from|to|cc|bcc|sent)\s*:/i.test(line)) continue;
          const before = cleanName(line.slice(0, match.index).split(/[|•‣]/).map((p) => p.trim()).filter(Boolean).pop() ?? "");
          const usable = (n: string) => n.length >= 3 && n.length <= 70 && /^[A-Z0-9]/.test(n) && !NOT_A_NAME.test(n) && !SENTENCE.test(n);
          let name: string = usable(before) ? before : "";
          for (let j = i - 1; !name && j >= Math.max(0, i - 3); j--) if (lines[j] && usable(cleanName(lines[j]))) name = cleanName(lines[j]);
          if (!name) name = section.heading && !/^(page \d+|document|contact( us)?)$/i.test(section.heading) ? section.heading : doc.title;
          const nearby = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
          const phone = nearby.match(PHONE);
          const location = nearby.match(LOCATION)?.[1]?.replace(/\s+/g, " ").trim();
          name = ROLE_INBOXES[email.split("@")[0]] ?? name;
          const existing = byEmail.get(email);
          const entry: Contact = existing ?? {
            name,
            email,
            // An officer's inbox found in an agenda belongs with the branch, not the meeting.
            collection: ((c) => (c === "meetings" ? "governance" : c))(classify(doc, section)),
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
      const online = /^(https?:\/\/|fla\.st\/|[\w.-]+\.zoom\.us|zoom$|teams$|microsoft teams|online|virtual)/i.test(part);
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
  return {
    contacts: extractContacts(docs),
    places: extractPlaces(docs),
    upcoming: extractUpcoming(docs),
    changes: editionChanges(docs.filter((d) => d.kind === "document")),
    builtAt: new Date().toISOString(),
  };
}
