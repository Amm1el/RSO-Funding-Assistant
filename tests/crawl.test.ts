import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRobots } from "../src/crawl/robots.js";
import { extractPage } from "../src/crawl/html.js";
import { crawl, inFullScope, inOneHopScope, normalizeUrl } from "../src/crawl/index.js";
import type { CorpusDoc } from "../src/crawl/types.js";

// The real sga.fsu.edu robots.txt (abridged).
const SGA_ROBOTS = `User-agent: *
Allow: /core/*.css$
Disallow: /core/
Disallow: /search/
Disallow: /user/
Disallow: /index.php/admin/`;

describe("robots.txt", () => {
  const r = parseRobots(SGA_ROBOTS);
  it("disallows listed paths and allows the rest", () => {
    expect(r.allows("/accounting/funding-your-rso")).toBe(true);
    expect(r.allows("/search/node?keys=x")).toBe(false);
    expect(r.allows("/user/login")).toBe(false);
  });
  it("lets the longer Allow rule win, with $ anchoring", () => {
    expect(r.allows("/core/misc/style.css")).toBe(true);
    expect(r.allows("/core/misc/style.css.map")).toBe(false);
  });
  it("allows everything when robots.txt is empty or missing", () => {
    expect(parseRobots("").allows("/anything")).toBe(true);
  });
});

// Shaped like FSU's Drupal pages: global nav, sidebar menu, content region, footer.
const PAGE = `<html><head><title>Funding Your RSO | Student Government Association</title></head><body>
<nav id="fsu-global-nav"><a href="/about">About</a></nav>
<main id="content"><div class="container"><div class="row">
<aside class="col-sm-3"><a href="/accounting/rso-purchasing-instructions">RSO Purchasing Instructions</a></aside>
<section class="col-sm-9"><div class="region region-content">
<h1>Funding Your RSO</h1><p>RSOs can request funding from two boards.</p>
<h2>RSO Allocation Committee</h2><ul><li>Up to $5,776 per year</li><li>Travel: $250 per student</li></ul>
<table><tr><th>Board</th><th>Email</th></tr><tr><td>RSOAC</td><td>sga-rsoac@fsu.edu</td></tr></table>
<p>Read the <a href="/sites/default/files/PDFs/Accounting/26-27SGAFM.pdf">Financial Manual</a>.</p>
</div></section></div></div></main>
<footer><p>Florida State University, Tallahassee FL</p></footer></body></html>`;

describe("extractPage", () => {
  const p = extractPage(PAGE, "https://sga.fsu.edu/accounting/funding-your-rso");
  it("takes the title from the h1 and splits sections at headings", () => {
    expect(p.title).toBe("Funding Your RSO");
    expect(p.sections.map((s) => s.heading)).toEqual(["Funding Your RSO", "RSO Allocation Committee"]);
  });
  it("keeps list items and table rows on their own lines", () => {
    const text = p.sections[1].text;
    expect(text).toContain("Up to $5,776 per year\nTravel: $250 per student");
    expect(text).toContain("RSOAC | sga-rsoac@fsu.edu");
  });
  it("drops navigation, sidebar and footer", () => {
    const all = p.sections.map((s) => s.text).join(" ");
    expect(all).not.toContain("RSO Purchasing Instructions");
    expect(all).not.toContain("Tallahassee FL");
  });
  it("returns absolute links, including ones outside the content", () => {
    expect(p.links.map((l) => l.href)).toContain("https://sga.fsu.edu/sites/default/files/PDFs/Accounting/26-27SGAFM.pdf");
    expect(p.links.map((l) => l.href)).toContain("https://sga.fsu.edu/about");
  });
});

describe("crawl scope", () => {
  it("crawls SGA sites fully, other FSU sites one hop, and skips the rest", () => {
    const u = (s: string) => new URL(s);
    expect(inFullScope(u("https://sga.fsu.edu/accounting"))).toBe(true);
    expect(inFullScope(u("https://sga.fsu.edu/search?keys=x"))).toBe(false);
    expect(inFullScope(u("https://sga.fsu.edu/galleries/homecoming"))).toBe(false);
    expect(inOneHopScope(u("https://soi.fsu.edu/registered-student-organizations"))).toBe(true);
    expect(inOneHopScope(u("https://admissions.fsu.edu/"))).toBe(false);
    expect(inOneHopScope(u("https://www.fsu.edu/"))).toBe(false);
    expect(inOneHopScope(u("https://www.instagram.com/fsusga"))).toBe(false);
  });
  it("normalizes http to https on FSU hosts and drops fragments", () => {
    expect(normalizeUrl("http://sga.fsu.edu/cogs#top")).toBe("https://sga.fsu.edu/cogs");
    expect(normalizeUrl("mailto:sga@fsu.edu")).toBeNull();
  });
});

describe("crawl (against a fake SGA site)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const manual = "data/26-27SGAFM.pdf";

  it("follows links, honors robots.txt, reads linked PDFs and meetings, and writes the corpus", async () => {
    const pdf = existsSync(manual) ? readFileSync(manual) : null;
    const site: Record<string, string> = {
      "https://sga.fsu.edu/": `<main><div class="region-content"><h1>SGA</h1><p>Welcome to the Student Government Association at FSU, serving every student.</p>
        <a href="/accounting/funding-your-rso">Funding</a><a href="/search/node">Search</a><a href="https://soi.fsu.edu/rso">SOI</a></div></main>`,
      "https://sga.fsu.edu/accounting/funding-your-rso": PAGE,
      "https://sai.fsu.edu/": `<main><div class="region-content"><h1>Student Agencies</h1><p>The agencies of SGA represent and serve diverse communities across campus.</p></div></main>`,
      "https://soi.fsu.edu/rso": `<main><div class="region-content"><h1>Registered Student Organizations</h1><p>SOI registers RSOs and supports officers. <a href="https://soi.fsu.edu/deeper">Deeper</a></p></div></main>`,
    };
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      requested.push(url);
      const respond = (body: BodyInit, type: string, status = 200) => {
        const r = new Response(body, { status, headers: { "content-type": type } });
        Object.defineProperty(r, "url", { value: url });
        return r;
      };
      if (url.endsWith("/robots.txt")) return respond(url.includes("sga.fsu.edu") ? SGA_ROBOTS : "", "text/plain");
      if (site[url]) return respond(site[url], "text/html; charset=utf-8");
      if (url.endsWith("26-27SGAFM.pdf") && pdf) return respond(pdf, "application/pdf");
      if (url.includes("GetEventsList") && url.includes("sortDescending=true"))
        return respond(
          JSON.stringify({
            hasMore: false,
            items: [
              {
                id: 2672,
                eventName: "RSO Allocation Committee (RSOAC)",
                startDateTime: new Date(Date.now() - 86400_000).toISOString(),
                categoryName: "SGA Funding Boards",
                eventLocation: { address1: "fla.st/sga-meet-rsoac" },
                publishedFiles: [{ fileId: 3883, type: "Agenda", name: "Agenda" }],
              },
            ],
          }),
          "application/json",
        );
      if (url.includes("GetEventsList")) return respond(JSON.stringify({ hasMore: false, items: [] }), "application/json");
      if (url.includes("GetMeetingFileStream(fileId=3883,plainText=true)")) return respond("RSO Allocations Committee\nCall to order\nNew business: funding requests", "text/plain");
      return respond("not found", "text/html", 404);
    });

    const outDir = await mkdtemp(join(tmpdir(), "corpus-"));
    const manifest = await crawl({
      outDir,
      sources: ["site", "documents", "meetings"],
      maxPages: 50,
      maxDocuments: 10,
      maxDocumentBytes: 30e6,
      meetingMonths: 24,
      log: () => {},
    });

    const read = async (s: string) => (await readFile(join(outDir, `${s}.jsonl`), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as CorpusDoc);
    const pages = await read("site");
    expect(pages.map((p) => p.url).sort()).toEqual([
      "https://sai.fsu.edu/",
      "https://sga.fsu.edu/",
      "https://sga.fsu.edu/accounting/funding-your-rso",
      "https://soi.fsu.edu/rso",
    ]);
    // robots.txt: /search/ is disallowed on sga.fsu.edu, so it was never requested.
    expect(requested).not.toContain("https://sga.fsu.edu/search/node");
    // One hop: the SOI page was read, but its own links were not followed.
    expect(requested).not.toContain("https://soi.fsu.edu/deeper");
    expect(pages.find((p) => p.host === "soi.fsu.edu")?.meta?.scope).toBe("one-hop");

    if (pdf) {
      const docs = await read("documents");
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({ kind: "document", parent: "https://sga.fsu.edu/accounting/funding-your-rso", title: "Financial Manual" });
      expect(docs[0].sections.find((s) => s.page === 12)?.text).toContain("$225 per night");
    }

    const meetings = await read("meetings");
    expect(meetings[0]).toMatchObject({ kind: "meeting", url: "https://fsusga.portal.civicclerk.com/event/2672/files", meta: { category: "SGA Funding Boards" } });
    expect(meetings[0].sections[1]).toMatchObject({ heading: "Agenda", url: "https://fsusga.portal.civicclerk.com/event/2672/files/agenda/3883" });
    expect(manifest.counts.site.documents).toBe(4);
  }, 60_000);
});
