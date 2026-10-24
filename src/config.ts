import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load .env from the repo root, not the current directory: Claude Desktop starts the
// MCP server from its own working directory.
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://rso:rso@localhost:5432/rso"),
  /**
   * Off by default: the app runs without any API calls even when keys are set, so it can be
   * demoed (and tested) keyless. Set USE_AI=true to use Claude/OpenAI (with keys) or a local
   * Ollama model (LOCAL_MODEL / LOCAL_EMBEDDING_MODEL, free, no key).
   */
  USE_AI: z
    .enum(["true", "false", "1", "0", ""])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANSWER_MODEL: z.string().default("claude-sonnet-5-5"),
  JUDGE_MODEL: z.string().default("claude-sonnet-5-5"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  /** Free local AI through Ollama (https://ollama.com), used when USE_AI=true and no API key is set. */
  OLLAMA_URL: z.string().default("http://localhost:11434"),
  /** A local chat model, e.g. "qwen2.5:7b" or "llama3.2:3b". */
  LOCAL_MODEL: z.string().optional(),
  /** A local embedding model, e.g. "nomic-embed-text". */
  LOCAL_EMBEDDING_MODEL: z.string().optional(),
  PORT: z.coerce.number().default(3000),
});

export const config = Env.parse(process.env);

/** Fail with a clear message when a feature needs a key that isn't set. */
export function requireKey(name: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY"): string {
  const value = config[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

export { EMBEDDING_DIMENSIONS } from "./hash-embedder.js";
