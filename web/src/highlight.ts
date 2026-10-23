/**
 * Splits a passage into plain and highlighted segments, marking each quote wherever it
 * appears. Matching ignores case and whitespace, the same rule the server uses to
 * verify citations, so every verified quote can be found.
 */
export function highlight(content: string, quotes: string[]): { text: string; marked: boolean }[] {
  const ranges: [number, number][] = [];
  for (const quote of quotes) {
    const words = quote.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i");
    const m = pattern.exec(content);
    if (m) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const out: { text: string; marked: boolean }[] = [];
  let pos = 0;
  for (const [start, end] of merged) {
    if (start > pos) out.push({ text: content.slice(pos, start), marked: false });
    out.push({ text: content.slice(start, end), marked: true });
    pos = end;
  }
  if (pos < content.length) out.push({ text: content.slice(pos), marked: false });
  return out;
}
