import OpenAI from "openai";
import { config, requireKey, EMBEDDING_DIMENSIONS } from "./config.js";

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** OpenAI embeddings, sent in batches to stay under request limits. */
export class OpenAIEmbedder implements Embedder {
  private client = new OpenAI({ apiKey: requireKey("OPENAI_API_KEY") });

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    const batchSize = 96;
    for (let i = 0; i < texts.length; i += batchSize) {
      const res = await this.client.embeddings.create({
        model: config.EMBEDDING_MODEL,
        input: texts.slice(i, i + batchSize),
      });
      out.push(...res.data.map((d) => d.embedding));
    }
    return out;
  }
}

/**
 * Deterministic bag-of-words embedder for tests and offline development.
 * Words are hashed into buckets, so texts sharing words point in similar directions.
 */
export class HashEmbedder implements Embedder {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let h = 2166136261;
        for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
        v[Math.abs(h) % EMBEDDING_DIMENSIONS] += 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
