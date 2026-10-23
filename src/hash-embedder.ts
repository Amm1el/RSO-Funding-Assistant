/** 1536 matches OpenAI text-embedding-3-small, so both embedders fit the same vector column. */
export const EMBEDDING_DIMENSIONS = 1536;

/** Common words that would otherwise dominate a bag-of-words vector. */
const STOP_WORDS = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its may me much my no not of on or our so than that the their them then there these they this to us was we what when where which who why will with you your".split(
    " ",
  ),
);

/**
 * Deterministic bag-of-words embedder for tests, CI and running without an API key.
 * Words are hashed into buckets, so texts sharing words point in similar directions.
 * It has no notion of meaning ("car" and "vehicle" are unrelated), which is exactly
 * why it makes a useful lower bound in the eval.
 */
export class HashEmbedder {
  readonly name = "hash:bow-1536";
  readonly minSimilarity = 0.12;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const word of text.toLowerCase().match(/[a-z0-9$]+/g) ?? []) {
        if (STOP_WORDS.has(word)) continue;
        let h = 2166136261;
        for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
        v[Math.abs(h) % EMBEDDING_DIMENSIONS] += 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
