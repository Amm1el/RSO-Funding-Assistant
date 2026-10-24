import { describe, expect, it } from "vitest";
import { extractContacts, extractPlaces } from "../src/corpus/directory.js";
import type { CorpusDoc } from "../src/crawl/types.js";

const page = (url: string, heading: string, text: string): CorpusDoc => ({
  id: url, url, title: "Accounting", kind: "page", host: new URL(url).host, fetchedAt: "2026-10-24", sections: [{ heading, text }],
});

describe("directory: contacts", () => {
  const docs = [
    page("https://sga.fsu.edu/accounting", "Contact Information & Compliance", "SGA Accounting Office\nLocation: Student Union 3268\nPhone: (850) 644-7574\nEmail: sgaaccounting@fsu.edu"),
    page("https://sga.fsu.edu/funding", "Funding Options", "RSOs may contact the Student Body Treasurer at SGA-SBT@fsu.edu with any questions."),
    page("https://sga.fsu.edu/staff", "Staff", "Director of Student Government | sga-director@fsu.edu | 850.644.1811 | Oglesby Student Union 4200"),
    page("https://sga.fsu.edu/council", "Officers", "Treasurer Jane Doe | jd23x@my.fsu.edu\nPresident John Roe | jr22@fsu.edu"),
  ];
  const contacts = extractContacts(docs);
  const by = (email: string) => contacts.find((c) => c.email === email);

  it("names a contact by the nearest line above when the email line is just a label", () => {
    expect(by("sgaaccounting@fsu.edu")).toMatchObject({ name: "SGA Accounting Office", phone: "(850) 644-7574", location: "Student Union 3268", collection: "funding" });
  });
  it("names a contact by the text in front of the email on the same line", () => {
    expect(by("sga-sbt@fsu.edu")?.name).toBe("Student Body Treasurer");
  });
  it("splits table-like rows and normalizes phone formats", () => {
    expect(by("sga-director@fsu.edu")).toMatchObject({ name: "Director of Student Government", phone: "(850) 644-1811", location: "Oglesby Student Union 4200" });
  });
  it("keeps one entry per email and links its source", () => {
    expect(contacts).toHaveLength(3);
  });
  it("leaves out students' personal accounts: the directory lists offices, not people", () => {
    expect(by("jd23x@my.fsu.edu")).toBeUndefined();
    expect(by("jr22@fsu.edu")).toBeUndefined();
  });
  it("labels well-known inboxes by role, which doesn't go stale when officers change", () => {
    expect(by("sgaaccounting@fsu.edu")?.source.url).toBe("https://sga.fsu.edu/accounting");
    expect(extractContacts([page("https://sga.fsu.edu/x", "Exec", "Student Body Treasurer • Some Name | sga-sbt@fsu.edu")])[0].name).toBe("Student Body Treasurer");
  });
});

describe("directory: places", () => {
  const meeting = (category: string, where: string, date: string): CorpusDoc => ({
    id: where + date, url: "https://x/" + date, title: "m", kind: "meeting", host: "x", fetchedAt: date,
    sections: [{ heading: "Meeting details", text: `Meeting\nCategory: ${category}\nWhen: today\nWhere: ${where}` }],
    meta: { category, date },
  });
  it("groups meetings by place, separates online links, and ranks by use", () => {
    const places = extractPlaces([
      meeting("Student Senate", "Senate Chambers", "2026-10-21"),
      meeting("Student Senate", "Senate Chambers", "2026-10-14"),
      meeting("COGS", "Senate Chambers", "2026-10-12"),
      meeting("Student Senate", "NSU 3rd Floor Project Room fla.st/sga-meet-rules", "2026-10-23"),
    ]);
    expect(places[0]).toMatchObject({ name: "Senate Chambers", meetings: 3, usedBy: ["Student Senate", "COGS"], lastMeeting: "2026-10-21", online: false });
    expect(places.map((p) => p.name)).toEqual(["Senate Chambers", "NSU 3rd Floor Project Room", "fla.st/sga-meet-rules"]);
    expect(places[2].online).toBe(true);
  });
});
