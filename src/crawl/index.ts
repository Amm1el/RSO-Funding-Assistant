import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PoliteFetcher } from "./http.js";
import { extractPage } from "./html.js";
import { documentType, docxSections, ocrAvailable, ocrPdfSections, pdfSections } from "./documents.js";
import { crawlMunicode } from "./municode.js";
import { crawlMeetings } from "./civicclerk.js";
import { docId } from "./ids.js";
import type { CorpusDoc, CorpusSection } from "./types.js";

export type CrawlSource = "site" | "documents" | "code" | "meetings";

export interface CrawlOptions {
  outDir: string;
  sources: CrawlSource[];
  maxPages: number;
  maxDocuments: number;
  maxDocumentBytes: number;
  meetingMonths: number;
  log?: (m: string) => void;
}

/** Crawled in full: every page reachable from the home page. */
export const FULL_HOSTS = new Set(["sga.fsu.edu", "sai.fsu.edu"]);
/** Other FSU sites get one hop (the linked page only), except these, which aren't about student government. */
const ONE_HOP_EXCLUDE = /^(www\.)?(fsu\.edu|webmail|admissions|research|faculty|directory|report|knowmore|hq|my|canvas|login|cas|apply|news|give|alumni)\./;
const DOCUMENT_HOSTS = /(^|\.)fsu\.edu$|^s3-us-west-2\.amazonaws\.com$/;
const SKIP_PATHS = /^\/(galleries|user|search|admin|node\/add|core|profiles|index\.php)(\/|$)|\.(jpe?g|png|gif|svg|webp|mp4|mov|zip|ics|xml|css|js)$/i;

export function normalizeUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.host.endsWith("fsu.edu")) u.protocol = "https:";
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

export function inFullScope(u: URL) {
  return FULL_HOSTS.has(u.host) && !u.search && !SKIP_PATHS.test(u.pathname);
}
export function inOneHopScope(u: URL) {
  return (u.host === "fsu.edu" || u.host.endsWith(".fsu.edu")) && !FULL_HOSTS.has(u.host) && !ONE_HOP_EXCLUDE.test(u.host + ".") && !SKIP_PATHS.test(u.pathname);
}

export async function crawl(opts: CrawlOptions) {
  const log = opts.log ?? console.log;
  const fetcher = new PoliteFetcher();
  const errors: string[] = [];
  // Scanned PDFs get OCR when the tools are installed (the crawl workflow installs them).
  const canOcr = ocrAvailable();
  let ocrCount = 0;
  const pages: CorpusDoc[] = [];
  const documentLinks = new Map<string, { parent: string; text: string }>();
  const out: Partial<Record<CrawlSource, CorpusDoc[]>> = {};

  if (opts.sources.includes("site") || opts.sources.includes("documents")) {
    log("Site: crawling sga.fsu.edu and sai.fsu.edu (+ one hop to linked FSU pages)");
    const queue: { url: string; full: boolean }[] = [...FULL_HOSTS].map((h) => ({ url: `https://${h}/`, full: true }));
    const seen = new Set(queue.map((q) => q.url));
    const done = new Set<string>();

    let inFlight = 0;
    const worker = async () => {
      // Keep going while there's work queued or another worker may still add some.
      while ((queue.length || inFlight) && pages.length < opts.maxPages) {
        if (!queue.length) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        const { url, full } = queue.shift()!;
        inFlight++;
        try {
          const res = await fetcher.get(url);
          if (!res) continue;
          const finalUrl = normalizeUrl(res.url) ?? url;
          if (done.has(finalUrl)) continue;
          done.add(finalUrl);
          const type = res.headers.get("content-type") ?? "";
          if (!res.ok) {
            errors.push(`${res.status} ${url}`);
            continue;
          }
          if (!type.includes("text/html")) {
            if (documentType(finalUrl)) documentLinks.set(finalUrl, { parent: url, text: "" });
            continue;
          }
          const page = extractPage(await res.text(), finalUrl);
          pages.push({
            id: docId(finalUrl),
            url: finalUrl,
            title: page.title || finalUrl,
            kind: "page",
            host: new URL(finalUrl).host,
            fetchedAt: new Date().toISOString(),
            sections: page.sections,
            meta: { scope: full ? "full" : "one-hop" },
          });
          if (!full) continue;
          for (const link of page.links) {
            const n = normalizeUrl(link.href);
            if (!n) continue;
            const u = new URL(n);
            if (documentType(n)) {
              if (DOCUMENT_HOSTS.test(u.host) && !documentLinks.has(n)) documentLinks.set(n, { parent: finalUrl, text: link.text });
              continue;
            }
            if (seen.has(n)) continue;
            if (inFullScope(u)) {
              seen.add(n);
              queue.push({ url: n, full: true });
            } else if (inOneHopScope(u) && !u.search) {
              seen.add(n);
              queue.push({ url: n, full: false });
            }
          }
          if (pages.length % 50 === 0) log(`  ${pages.length} pages, ${queue.length} queued, ${documentLinks.size} documents found`);
        } catch (err) {
          errors.push(`${(err as Error).message} ${url}`);
        } finally {
          inFlight--;
        }
      }
    };
    // Several workers so different hosts progress in parallel; each host is still one at a time.
    await Promise.all(Array.from({ length: 4 }, worker));
    log(`  done: ${pages.length} pages, ${documentLinks.size} linked documents`);
    if (opts.sources.includes("site")) out.site = pages;
  }

  if (opts.sources.includes("code")) {
    log("Code: municipal code books (rendered in a headless browser)");
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const { docs, linkedDocuments } = await crawlMunicode(browser, fetcher, log);
      out.code = docs;
      for (const [href, text] of linkedDocuments) {
        const n = normalizeUrl(href);
        if (n && !documentLinks.has(n)) documentLinks.set(n, { parent: "municipal code", text });
      }
    } catch (err) {
      errors.push(`municipal code: ${(err as Error).message}`);
      log(`  failed: ${(err as Error).message}`);
    } finally {
      await browser.close();
    }
  }

  if (opts.sources.includes("documents")) {
    // SGA's own documents first, then legislation linked from the code books.
    const ordered = [...documentLinks].sort(([a], [b]) => Number(b.includes("sga.fsu.edu")) - Number(a.includes("sga.fsu.edu")));
    log(`Documents: ${ordered.length} linked (taking up to ${opts.maxDocuments})`);
    const docs: CorpusDoc[] = [];
    for (const [url, { parent, text }] of ordered.slice(0, opts.maxDocuments)) {
      try {
        const res = await fetcher.get(url);
        if (!res?.ok) {
          if (res) errors.push(`${res.status} ${url}`);
          continue;
        }
        const size = Number(res.headers.get("content-length") ?? 0);
        if (size > opts.maxDocumentBytes) {
          errors.push(`skipped (too large, ${size} bytes) ${url}`);
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const kind = documentType(url);
        let parsed: { title?: string; sections: CorpusSection[] } | null = kind === "pdf" ? await pdfSections(bytes) : kind === "docx" ? await docxSections(bytes) : null;
        let ocr = false;
        if (kind === "pdf" && parsed && !parsed.sections.length && canOcr) {
          parsed = await ocrPdfSections(bytes);
          ocr = parsed.sections.length > 0;
          if (ocr) ocrCount++;
        }
        if (!parsed || !parsed.sections.length) {
          errors.push(`no text (scanned image?) ${url}`);
          continue;
        }
        const fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? url);
        docs.push({
          id: docId(url),
          url,
          title: text || ("title" in parsed && typeof parsed.title === "string" && parsed.title) || fileName.replace(/\.(pdf|docx)$/i, "").replace(/[-_]+/g, " "),
          kind: "document",
          host: new URL(url).host,
          fetchedAt: new Date().toISOString(),
          parent,
          sections: parsed.sections,
          meta: { file: fileName, bytes: bytes.byteLength, ...(ocr ? { ocr: true } : {}) },
        });
        if (docs.length % 50 === 0) log(`  ${docs.length} documents read`);
      } catch (err) {
        errors.push(`${(err as Error).message} ${url}`);
      }
    }
    out.documents = docs;
    log(`  done: ${docs.length} documents with text`);
  }

  if (opts.sources.includes("meetings")) {
    log(`Meetings: CivicClerk, last ${opts.meetingMonths} months + upcoming`);
    try {
      out.meetings = await crawlMeetings(fetcher, log, { monthsBack: opts.meetingMonths });
    } catch (err) {
      errors.push(`meetings: ${(err as Error).message}`);
      log(`  failed: ${(err as Error).message}`);
    }
  }

  await mkdir(opts.outDir, { recursive: true });
  const counts: Record<string, { documents: number; sections: number; chars: number }> = {};
  for (const [source, docs] of Object.entries(out)) {
    await writeFile(join(opts.outDir, `${source}.jsonl`), docs!.map((d) => JSON.stringify(d)).join("\n") + "\n");
    counts[source] = {
      documents: docs!.length,
      sections: docs!.reduce((s, d) => s + d.sections.length, 0),
      chars: docs!.reduce((s, d) => s + d.sections.reduce((t, x) => t + x.text.length, 0), 0),
    };
  }
  const manifest = { crawledAt: new Date().toISOString(), counts, errors: errors.length, ocr: ocrCount, skippedByRobots: fetcher.skippedByRobots.length };
  await writeFile(join(opts.outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(
    join(opts.outDir, "crawl-report.md"),
    [
      `# Crawl report (${manifest.crawledAt})`,
      "",
      "| Source | Documents | Sections | Characters |",
      "|---|---|---|---|",
      ...Object.entries(counts).map(([s, c]) => `| ${s} | ${c.documents} | ${c.sections} | ${c.chars.toLocaleString()} |`),
      "",
      `## Skipped by robots.txt (${fetcher.skippedByRobots.length})`,
      ...fetcher.skippedByRobots.slice(0, 200).map((u) => `- ${u}`),
      "",
      `## Errors (${errors.length})`,
      ...errors.slice(0, 500).map((e) => `- ${e}`),
      "",
    ].join("\n"),
  );
  log(`Wrote ${opts.outDir}: ${JSON.stringify(counts)}`);
  return manifest;
}
