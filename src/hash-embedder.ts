import { terms } from "./terms.js";

/** 1536 matches OpenAI text-embedding-3-small, so both embedders fit the same vector column. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Deterministic bag-of-words embedder for tests, CI and running without an API key.
 * Stemmed words (the shared tokenizer) are hashed into buckets with sublinear term
 * frequency, so texts sharing words point in similar directions. It has no notion of
 * meaning ("car" and "vehicle" are unrelated), which is why it's the eval's lower bound.
 * v2 added stemming and sublinear tf; the name changed so an old index is never mixed in.
 */
export class HashEmbedder {
  readonly name = "hash:bow2-1536";
  readonly minSimilarity = 0.12;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Float64Array(EMBEDDING_DIMENSIONS);
      for (const word of terms(text)) {
        let h = 2166136261;
        for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
        v[Math.abs(h) % EMBEDDING_DIMENSIONS] += 1;
      }
      let norm = 0;
      for (let i = 0; i < v.length; i++) {
        if (v[i] > 0) v[i] = 1 + Math.log(v[i]);
        norm += v[i] * v[i];
      }
      norm = Math.sqrt(norm) || 1;
      return Array.from(v, (x) => x / norm);
    });
  }
}
