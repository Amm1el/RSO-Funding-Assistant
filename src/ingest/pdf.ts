import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

/** Returns one string per page so chunks can cite page numbers. */
export async function readPdfPages(path: string): Promise<string[]> {
  const buffer = await readFile(path);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}
