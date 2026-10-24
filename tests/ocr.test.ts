import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { ocrAvailable, ocrPdfSections, pdfSections } from "../src/crawl/documents.js";

// tests/fixtures/scanned.pdf is an image of text with no text layer, like the scanned
// minutes and filings on sga.fsu.edu. Skipped where tesseract/poppler aren't installed.
describe.skipIf(!ocrAvailable())("OCR for scanned PDFs", () => {
  it("has no text layer, so the normal extractor finds nothing", async () => {
    const bytes = new Uint8Array(await readFile("tests/fixtures/scanned.pdf"));
    expect((await pdfSections(bytes)).sections).toHaveLength(0);
  });
  it("reads the page image and keeps the page number", async () => {
    const { sections } = await ocrPdfSections(new Uint8Array(await readFile("tests/fixtures/scanned.pdf")));
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ heading: "Page 1", page: 1 });
    expect(sections[0].text).toMatch(/Allocation Committee/);
    expect(sections[0].text).toMatch(/\$250 per student/);
  });
});
