import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://rso:rso@localhost:5432/rso"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANSWER_MODEL: z.string().default("claude-sonnet-5-5"),
  JUDGE_MODEL: z.string().default("claude-sonnet-5-5"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  PORT: z.coerce.number().default(3000),
});

export const config = Env.parse(process.env);

/** Fail with a clear message when a feature needs a key that isn't set. */
export function requireKey(name: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY"): string {
  const value = config[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

export const EMBEDDING_DIMENSIONS = 1536;
