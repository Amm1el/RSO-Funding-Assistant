import type { Browser } from "playwright";
import { USER_AGENT, type PoliteFetcher } from "./http.js";
import type { CorpusDoc, CorpusSection } from "./types.js";
import { docId } from "./ids.js";

export const MUNICODE = "https://fsusga.municipalcodeonline.com";

/** The site's books, by the `type` it uses in URLs. */
export const BOOKS: Record<string, string> = {
  ordinances: "Student Body Constitution",
  resolutions: "Executive Branch",
  plan: "Student Senate",
  policies: "Congress of Graduate Students",
  orders: "Union and Campus Recreation Board",
  signs: "Judicial Branch and Elections",
};

/** Superseded text; answering from it would give out-of-date rules. */
const SKIP_SUBBOOKS = /ARCHIVE/i;

/**
 * Reads each book the way a visitor does: a real browser loads the page, and the text is
 * taken from what it renders. The site refuses direct requests to its data endpoints, so
 * this deliberately stays on the public pages. Sections split at the book's own headings
 * (".phx-name"), each with a deep link like book?type=plan#name=Chapter_806_Funding_Boards.
 */
export async function crawlMunicode(
  browser: Browser,
  fetcher: PoliteFetcher,
  log: (m: string) => void,
  opts: { base?: string; books?: Record<string, string> } = {},
) {
  const base = opts.base ?? MUNICODE;
  const docs: CorpusDoc[] = [];
  const linkedDocuments = new Map<string, string>();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  for (const [type, bookTitle] of Object.entries(opts.books ?? BOOKS)) {
    const bookUrl = `${base}/book?type=${type}`;
    if (!(await fetcher.allowed(bookUrl))) {
      log(`  robots.txt disallows ${bookUrl}; skipping`);
      continue;
    }
    await page.goto(bookUrl, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForFunction(() => (document.querySelector("#contents") as HTMLElement | null)?.innerText.length! > 200, null, { timeout: 90_000 });
    const subBooks: string[] = await page.$$eval("#TOC > ul > li > div span.k-in", (els) => els.map((e) => e.textContent!.trim()));
    const names = subBooks.length ? subBooks : [bookTitle.toUpperCase()];

    for (const name of names) {
      if (SKIP_SUBBOOKS.test(name)) continue;
      const anchor = name.replace(/ /g, "_");
      const url = `${bookUrl}#name=${encodeURIComponent(anchor)}`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
      await page
        .waitForFunction(
          (want) => (document.querySelector("#contents .phx-name a")?.textContent ?? "").trim().toUpperCase() === want,
          name.toUpperCase(),
          { timeout: 90_000 },
        )
        .catch(() => log(`  ${bookTitle} / ${name}: heading didn't match; using what loaded`));
      await page.waitForTimeout(1500);

      const { raw, links } = await page.evaluate(() => {
        const root = (document.querySelector("#contents") as HTMLElement).cloneNode(true) as HTMLElement;
        // Drop the table-of-contents link lists; keep the text.
        root.querySelectorAll(".toc > span").forEach((s) => {
          const a = s.querySelector("a");
          if (a && s.children.length === 1 && (a.getAttribute("href") ?? "").startsWith("#name=")) {
            const next = s.nextElementSibling;
            if (next?.tagName === "BR") next.remove();
            s.remove();
          }
        });
        root.querySelectorAll(".phx-name").forEach((h) => {
          const a = h.querySelector("a");
          const href = a?.getAttribute("href") ?? "";
          h.replaceWith(document.createTextNode(`\n\u0001${href.replace(/^#name=/, "")}\u0002${(a?.textContent ?? "").trim()}\n`));
        });
        const links = [...root.querySelectorAll("a[href]")].map((a) => [(a as HTMLAnchorElement).href, a.textContent!.trim()]);
        // innerText needs a rendered element to keep line breaks.
        const holder = document.createElement("div");
        holder.style.cssText = "position:absolute;left:-100000px;top:0;width:900px";
        holder.appendChild(root);
        document.body.appendChild(holder);
        const raw = root.innerText;
        holder.remove();
        return { raw, links };
      });

      const sections: CorpusSection[] = [];
      for (const part of raw.split("\u0001")) {
        const [head, ...rest] = part.split("\u0002");
        if (!rest.length) continue;
        const [titleLine, ...body] = rest.join("\u0002").split("\n");
        const text = body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
        if (!text) continue;
        sections.push({ heading: titleLine.trim(), text, url: `${bookUrl}#name=${encodeURIComponent(head.trim())}` });
      }
      for (const [href, text] of links) if (/\.pdf($|\?)/i.test(href)) linkedDocuments.set(href, text);

      docs.push({
        id: docId(url),
        url,
        title: `${bookTitle}: ${titleCase(name)}`,
        kind: "code",
        host: new URL(base).host,
        fetchedAt: new Date().toISOString(),
        sections,
        meta: { book: bookTitle, subBook: name },
      });
      log(`  ${bookTitle} / ${name}: ${sections.length} sections, ${raw.length.toLocaleString()} chars`);
    }
  }
  await context.close();
  return { docs, linkedDocuments };
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
