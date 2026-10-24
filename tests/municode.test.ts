import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { crawlMunicode } from "../src/crawl/municode.js";
import { PoliteFetcher } from "../src/crawl/http.js";

// Imitates fsusga.municipalcodeonline.com: a #TOC tree of sub-books, and #contents that a
// script fills in for whichever sub-book the #name= anchor points at.
const BOOKS: Record<string, string> = {
  STUDENT_BODY_STATUTES: `
    <div><div class="phx-name"><a class="k-link" href="#name=STUDENT_BODY_STATUTES">STUDENT BODY STATUTES</a></div></div>
    <div class="toc"><span><a class="k-link" href="#name=TITLE_VIII:_THE_FINANCE_CODE">TITLE VIII: THE FINANCE CODE</a></span><br>
      <div><div class="phx-name"><a class="k-link" href="#name=Chapter_806_Funding_Boards">Chapter 806 Funding Boards</a></div></div>
      <p>806.1 The RSO Allocation Committee shall allocate funds to registered student organizations.</p>
      <p><em>Revised by Bill <a href="https://s3-us-west-2.amazonaws.com/municipalcodeonline.com-new/fsusga/plan/documents/1_B78-021.pdf">B78-021</a> on 6/17/2026</em></p>
      <div><div class="phx-name"><a class="k-link" href="#name=Chapter_807_Operation_Procedures">Chapter 807 Operation Procedures</a></div></div>
      <ol><li>Requests shall be submitted through FSU HQ.</li><li>Receipts are due within ten business days.</li></ol>
    </div>`,
  SENATE_POLICIES: `
    <div><div class="phx-name"><a class="k-link" href="#name=SENATE_POLICIES">SENATE POLICIES</a></div></div>
    <p>Senate meetings are held on Wednesdays at 7:30 PM in the Senate Chambers.</p>`,
  THE_ARCHIVE_BOOK: `<div><div class="phx-name"><a class="k-link" href="#name=THE_ARCHIVE_BOOK">THE ARCHIVE BOOK</a></div></div><p>Repealed text.</p>`,
};
const PAGE = `<!doctype html><html><body>
<div id="TOC"><ul><li><div><span class="k-in">STUDENT BODY STATUTES</span></div></li><li><div><span class="k-in">SENATE POLICIES</span></div></li><li><div><span class="k-in">THE ARCHIVE BOOK</span></div></li></ul></div>
<div id="contents"></div>
<script>
const BOOKS = ${JSON.stringify(BOOKS)};
function render() {
  const name = decodeURIComponent((location.hash.match(/name=([^&]+)/) || [])[1] || "STUDENT_BODY_STATUTES");
  const key = Object.keys(BOOKS).find((k) => name === k || name.startsWith(k)) || "STUDENT_BODY_STATUTES";
  setTimeout(() => { document.getElementById("contents").innerHTML = BOOKS[key]; }, 150);
}
addEventListener("hashchange", render); render();
</script></body></html>`;

let server: Server;
let base = "";
let browser: Browser | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/robots.txt") return void res.end("User-agent: *\nDisallow: /account/");
    res.setHeader("content-type", "text/html");
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}).catch(() => undefined);
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});

describe("municipal code reader", () => {
  it("reads each sub-book except the archive, split at its headings with deep links", async (ctx) => {
    if (!browser) return ctx.skip();
    const { docs, linkedDocuments } = await crawlMunicode(browser, new PoliteFetcher(0), () => {}, { base, books: { plan: "Student Senate" } });

    expect(docs.map((d) => d.title)).toEqual(["Student Senate: Student Body Statutes", "Student Senate: Senate Policies"]);
    const statutes = docs[0];
    expect(statutes.sections.map((s) => s.heading)).toEqual(["Chapter 806 Funding Boards", "Chapter 807 Operation Procedures"]);
    expect(statutes.sections[0].text).toContain("806.1 The RSO Allocation Committee");
    expect(statutes.sections[0].text).toContain("Revised by Bill B78-021 on 6/17/2026");
    // The TOC link list ("TITLE VIII: THE FINANCE CODE") is navigation, not content.
    expect(statutes.sections.map((s) => s.text).join(" ")).not.toContain("TITLE VIII");
    expect(statutes.sections[1].text).toMatch(/Requests shall be submitted through FSU HQ\.\s*\n\s*Receipts are due/);
    expect(statutes.sections[0].url).toBe(`${base}/book?type=plan#name=Chapter_806_Funding_Boards`);
    expect([...linkedDocuments.keys()]).toEqual(["https://s3-us-west-2.amazonaws.com/municipalcodeonline.com-new/fsusga/plan/documents/1_B78-021.pdf"]);
    expect(docs[1].sections[0].text).toContain("Wednesdays at 7:30 PM");
  }, 120_000);
});
