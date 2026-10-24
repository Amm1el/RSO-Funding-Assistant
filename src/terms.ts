/**
 * The one tokenizer used everywhere words are compared: the offline embedder, BM25 keyword
 * search (in Postgres and in the phone build), and the extractive answerer. Sharing it keeps
 * server and phone rankings identical.
 */
export const STOP = new Set(
  "a an and any are as at be by can could do does for from get got has have how i if in into is it its may me might much my need no not of on or our should so than that the their them then there these they this to us was we what when where which who why will with would you your rso rsos sga".split(
    " ",
  ),
);

/** A tiny suffix stripper: "receipts" → "receipt", "recorded" → "record", "reimbursement" → "reimburse". */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of ["ment", "ing", "ed", "er", "es", "s"]) {
    if (word.endsWith(suffix) && !word.endsWith("ss") && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  return word;
}

/** raw word -> its term, or null for stop words. The vocabulary is small next to the text. */
const memo = new Map<string, string | null>();

/** Lowercased, stemmed content words, without stop words. */
export function terms(text: string): string[] {
  const out: string[] = [];
  const re = /[a-z0-9$%,.]+/g;
  const lower = text.toLowerCase();
  for (let m = re.exec(lower); m; m = re.exec(lower)) {
    let term = memo.get(m[0]);
    if (term === undefined) {
      const w = m[0].replace(/[.,]+$/, "");
      term = !w || STOP.has(w) ? null : stem(w);
      if (memo.size < 500_000) memo.set(m[0], term);
    }
    if (term !== null) out.push(term);
  }
  return out;
}

