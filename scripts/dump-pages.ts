// Prints the manual's text page by page. Useful for writing eval questions.
// Usage: npx tsx scripts/dump-pages.ts data/26-27SGAFM.pdf
import { readPdfPages } from "../src/ingest/pdf.js";
const pages = await readPdfPages(process.argv[2] ?? "data/26-27SGAFM.pdf");
pages.forEach((p, i) => console.log(`\n######## PAGE ${i + 1}\n${p}`));
