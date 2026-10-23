import type pg from "pg";
import { config } from "./config.js";
import { getActiveDocument, type DocumentInfo } from "./db.js";
import { embedderByName } from "./embeddings.js";
import { ClaudeAnswerGenerator, type AnswerGenerator } from "./answer.js";
import { ExtractiveGenerator } from "./extractive.js";
import type { Deps } from "./pipeline.js";

export type GeneratorChoice = "auto" | "claude" | "extractive";

/** Claude when ANTHROPIC_API_KEY is set (or asked for), otherwise the extractive baseline. */
export function createGenerator(choice: GeneratorChoice = "auto"): AnswerGenerator {
  if (choice === "extractive") return new ExtractiveGenerator();
  if (choice === "claude" || config.ANTHROPIC_API_KEY) return new ClaudeAnswerGenerator();
  return new ExtractiveGenerator();
}

/**
 * Builds everything the API, MCP server, CLI and evals need from one place.
 * The embedder is chosen by the active document, so questions are always embedded
 * with the same model that embedded the manual.
 */
export async function createDeps(pool: pg.Pool, generator: GeneratorChoice = "auto"): Promise<Deps & { document: DocumentInfo }> {
  const document = await getActiveDocument(pool);
  if (!document || document.chunks === 0) {
    throw new Error("No manual has been ingested yet. Run: npm run ingest -- data/26-27SGAFM.pdf");
  }
  return {
    pool,
    document,
    documentId: document.id,
    embedder: embedderByName(document.embedder),
    generator: createGenerator(generator),
  };
}
