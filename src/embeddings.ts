import OpenAI from "openai";
import { config, requireKey, EMBEDDING_DIMENSIONS } from "./config.js";

export interface Embedder {
  /** Stored with each ingested document, e.g. "openai:text-embedding-3-small". */
  readonly name: string;
  /**
   * Below this cosine similarity, the best match is treated as unrelated and the question
   * is refused. Each model has its own similarity scale, so the cutoff belongs to the model.
   */
  readonly minSimilarity: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** OpenAI embeddings, sent in batches to stay under request limits. */
export class OpenAIEmbedder implements Embedder {
  readonly name = `openai:${config.EMBEDDING_MODEL}`;
  readonly minSimilarity = 0.25;
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
export class HashEmbedder implements Embedder {
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

/** Recreates the embedder a document was ingested with, so questions use the same model. */
export function embedderByName(name: string): Embedder {
  if (name.startsWith("hash:")) return new HashEmbedder();
  if (name.startsWith("openai:")) {
    if (name !== `openai:${config.EMBEDDING_MODEL}`) {
      throw new Error(`The manual was embedded with ${name} but EMBEDDING_MODEL is ${config.EMBEDDING_MODEL}. Re-ingest or change EMBEDDING_MODEL.`);
    }
    return new OpenAIEmbedder();
  }
  throw new Error(`Unknown embedder "${name}"`);
}

/** OpenAI only when USE_AI=true and a key is set; otherwise the offline hash embedder. */
export function defaultEmbedder(): Embedder {
  return config.USE_AI && config.OPENAI_API_KEY ? new OpenAIEmbedder() : new HashEmbedder();
}
