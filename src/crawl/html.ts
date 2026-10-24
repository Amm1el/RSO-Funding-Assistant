import * as cheerio from "cheerio";
import type { CorpusSection } from "./types.js";

/** Where the real content lives on FSU's Drupal sites, most specific first. */
const CONTENT_SELECTORS = [".region-content", "main section", "article", "main", "#content", "body"];
/** Page chrome that repeats on every page and would drown out the content. */
const CHROME = "script, style, noscript, template, iframe, svg, nav, header, footer, aside, form, .breadcrumb, .visually-hidden, .sr-only, .skip-link, #fsu-global-nav";
const BLOCKS = "p, div, li, ul, ol, tr, table, section, article, blockquote, pre, dd, dt, dl, figure, figcaption, br, hr";
const HEADING = "\u0001";

export interface ExtractedPage {
  title: string;
  sections: CorpusSection[];
  links: { href: string; text: string }[];
}

/**
 * Turns a page into sections split at its headings (h1–h4). Block elements become line
 * breaks and table cells are joined with " | ", so lists and tables stay readable.
 */
export function extractPage(html: string, url: string): ExtractedPage {
  const $ = cheerio.load(html);
  const links = $("a[href]")
    .map((_, a) => ({ href: $(a).attr("href") ?? "", text: $(a).text().replace(/\s+/g, " ").trim() }))
    .get()
    .map((l) => {
      try {
        return { ...l, href: new URL(l.href, url).href };
      } catch {
        return null;
      }
    })
    .filter((l): l is { href: string; text: string } => l !== null);

  const title = ($("h1").first().text() || $("title").text().split("|")[0]).replace(/\s+/g, " ").trim();
  const root = CONTENT_SELECTORS.map((s) => $(s).first()).find((el) => el.length && el.text().trim().length > 80) ?? $("body");
  root.find(CHROME).remove();
  root.find("h1, h2, h3, h4").each((_, h) => {
    const text = $(h).text().replace(/\s+/g, " ").trim();
    $(h).replaceWith(`\n${HEADING}${text}\n`);
  });
  root.find("td, th").each((_, c) => void $(c).append(" | "));
  root.find(BLOCKS).each((_, b) => {
    $(b).prepend("\n");
    $(b).append("\n");
  });

  const lines = root
    .text()
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").replace(/(\s*\|\s*)+$/, "").trim())
    .filter(Boolean);

  const sections: CorpusSection[] = [];
  let current: CorpusSection = { heading: title, text: "" };
  for (const line of lines) {
    if (line.startsWith(HEADING)) {
      if (current.text.trim()) sections.push(current);
      current = { heading: line.slice(1).trim() || title, text: "" };
    } else {
      current.text += (current.text ? "\n" : "") + line;
    }
  }
  if (current.text.trim()) sections.push(current);
  return { title, sections, links };
}
