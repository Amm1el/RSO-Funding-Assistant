import { extractText, getDocumentProxy } from "unpdf";
import type { CorpusSection } from "./types.js";

/** One section per PDF page, so citations can name the page. */
export async function pdfSections(bytes: Uint8Array): Promise<{ title?: string; sections: CorpusSection[] }> {
  const pdf = await getDocumentProxy(bytes);
  const meta = await pdf.getMetadata().catch(() => null);
  const { text } = await extractText(pdf, { mergePages: false });
  const sections = text
    .map((t, i) => ({ heading: `Page ${i + 1}`, page: i + 1, text: t.replace(/[ \t]+/g, " ").trim() }))
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
