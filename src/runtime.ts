import type { DbPool } from "./dbpool.js";
import { config } from "./config.js";
import { getActiveCorpus, type CorpusInfo } from "./db.js";
import { embedderByName } from "./embeddings.js";
import { ClaudeAnswerGenerator, type AnswerGenerator } from "./answer.js";
import { ExtractiveGenerator } from "./extractive.js";
import { OllamaGenerator } from "./ollama.js";
import type { Deps } from "./pipeline.js";

export type GeneratorChoice = "auto" | "claude" | "ollama" | "extractive";

/**
 * "auto": with USE_AI on, Claude if ANTHROPIC_API_KEY is set, else a local Ollama model if
 * LOCAL_MODEL is set; otherwise (and always with USE_AI off) the extractive baseline.
 */
export function createGenerator(choice: GeneratorChoice = "auto"): AnswerGenerator {
  if (choice === "extractive") return new ExtractiveGenerator();
  if (choice === "claude") return new ClaudeAnswerGenerator();
  if (choice === "ollama") return new OllamaGenerator();
  if (config.USE_AI && config.ANTHROPIC_API_KEY) return new ClaudeAnswerGenerator();
  if (config.USE_AI && config.LOCAL_MODEL) return new OllamaGenerator(config.LOCAL_MODEL);
  return new ExtractiveGenerator();
}

/** Embedding providers usable right now, most preferred first. With USE_AI off, only the offline one. */
export function allowedProviders(): string[] {
  if (!config.USE_AI) return ["hash"];
  return [...(config.OPENAI_API_KEY ? ["openai"] : []), ...(config.LOCAL_EMBEDDING_MODEL ? ["ollama"] : []), "hash"];
}

/**
 * Builds everything the API, MCP server, CLI and evals need from one place. The embedder
 * comes from the stored corpus, so questions are always embedded with the same model that
 * embedded the sources.
 */
export async function createDeps(pool: DbPool, generator: GeneratorChoice = "auto"): Promise<Deps & { corpus: CorpusInfo }> {
  const corpus = await getActiveCorpus(pool, allowedProviders());
  if (!corpus) {
    throw new Error(
      "Nothing has been ingested for the current mode yet. Run: npm run ingest:corpus (or npm run demo, which does it for you).",
    );
  }
  return { pool, corpus, embedder: embedderByName(corpus.embedder), generator: createGenerator(generator) };
}
