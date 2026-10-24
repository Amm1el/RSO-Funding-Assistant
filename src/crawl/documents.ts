import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import type { CorpusSection } from "./types.js";

/** One section per PDF page, so citations can name the page. */
export async function pdfSections(bytes: Uint8Array): Promise<{ title?: string; sections: CorpusSection[] }> {
  // pdf.js takes ownership of (detaches) the buffer it's given; pass a copy so the caller
  // can still use the bytes, e.g. for OCR when there's no text layer.
  const pdf = await getDocumentProxy(bytes.slice());
  const meta = await pdf.getMetadata().catch(() => null);
  const { text } = await extractText(pdf, { mergePages: false });
  const sections = text
    .map((t, i) => ({ heading: `Page ${i + 1}`, page: i + 1, text: t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/[ \t]+/g, " ").trim() }))
    .filter((s) => s.text.length > 0);
  const info = (meta?.info ?? {}) as { Title?: string };
  return { title: info.Title?.trim() || undefined, sections };
}

/** Word documents: plain text, split at blank-line paragraphs into one section. */
export async function docxSections(bytes: Uint8Array): Promise<{ sections: CorpusSection[] }> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const text = value.replace(/\n{3,}/g, "\n\n").trim();
  return { sections: text ? [{ heading: "Document", text }] : [] };
}

export function documentType(url: string): "pdf" | "docx" | null {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".docx")) return "docx";
  return null;
}

/** True when the OCR tools (poppler's pdftoppm and tesseract) are installed. */
export function ocrAvailable(): boolean {
  const ok = (cmd: string) => spawnSync(cmd, ["-v"], { stdio: "ignore" }).status === 0;
  return ok("pdftoppm") && ok("tesseract");
}

/**
 * Text for scanned PDFs (no text layer): render each page at 200 dpi and read it with
 * Tesseract. One section per page, like pdfSections, so citations keep page numbers.
 * Capped at `maxPages` because OCR costs ~2 s a page and long scans are mostly old packets.
 */
export async function ocrPdfSections(bytes: Uint8Array, maxPages = 25): Promise<{ sections: CorpusSection[] }> {
  const dir = await mkdtemp(join(tmpdir(), "ocr-"));
  try {
    await writeFile(join(dir, "in.pdf"), bytes);
    const render = spawnSync("pdftoppm", ["-r", "200", "-gray", "-png", "-l", String(maxPages), join(dir, "in.pdf"), join(dir, "p")], { timeout: 180_000 });
    if (render.status !== 0) return { sections: [] };
    const pages = (await readdir(dir)).filter((f) => f.startsWith("p") && f.endsWith(".png")).sort();
    const sections: CorpusSection[] = [];
    for (const png of pages) {
      const page = Number(png.match(/(\d+)\.png$/)?.[1] ?? sections.length + 1);
      const out = spawnSync("tesseract", [join(dir, png), "stdout", "--psm", "3"], { encoding: "utf8", timeout: 60_000 });
      const text = (out.stdout ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      // Tesseract returns stray characters for blank or photo-only pages.
      if (text.replace(/[^a-z]/gi, "").length >= 40) sections.push({ heading: `Page ${page}`, page, text });
    }
    return { sections };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
