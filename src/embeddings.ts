import OpenAI from "openai";
import { config, requireKey } from "./config.js";
import { HashEmbedder } from "./hash-embedder.js";
import { OllamaEmbedder } from "./ollama.js";

export { HashEmbedder };

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

/** Recreates the embedder a document was ingested with, so questions use the same model. */
export function embedderByName(name: string): Embedder {
  if (name.startsWith("hash:")) {
    const current = new HashEmbedder();
    if (name !== current.name) throw new Error(`The sources were indexed with ${name}; this version uses ${current.name}. Re-ingest (npm run ingest:corpus).`);
    return current;
  }
  if (name.startsWith("ollama:")) return new OllamaEmbedder(name.slice("ollama:".length));
  if (name.startsWith("openai:")) {
    if (name !== `openai:${config.EMBEDDING_MODEL}`) {
      throw new Error(`The manual was embedded with ${name} but EMBEDDING_MODEL is ${config.EMBEDDING_MODEL}. Re-ingest or change EMBEDDING_MODEL.`);
    }
    return new OpenAIEmbedder();
  }
  throw new Error(`Unknown embedder "${name}"`);
}

/** With USE_AI on: OpenAI if keyed, else a local Ollama model if configured. Otherwise the offline hash embedder. */
export function defaultEmbedder(): Embedder {
  if (config.USE_AI && config.OPENAI_API_KEY) return new OpenAIEmbedder();
  if (config.USE_AI && config.LOCAL_EMBEDDING_MODEL) return new OllamaEmbedder(config.LOCAL_EMBEDDING_MODEL);
  return new HashEmbedder();
}
