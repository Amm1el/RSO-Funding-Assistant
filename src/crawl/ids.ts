import { createHash } from "node:crypto";

/** Stable short id for a URL, so re-crawls update documents instead of duplicating them. */
export function docId(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}
