import { config } from "./config.js";
import { AnswerToolInput, SYSTEM_PROMPT, buildUserMessage, type AnswerGenerator } from "./answer.js";
import type { Embedder } from "./embeddings.js";
import { EMBEDDING_DIMENSIONS } from "./hash-embedder.js";
import type { RetrievedChunk } from "./types.js";

/**
 * Free, local AI through Ollama: no account and no API key. Runs on the user's own machine
 * (`ollama pull qwen2.5:7b`, `ollama pull nomic-embed-text`).
 */

/** The same answer shape Claude is forced into, as a JSON schema for Ollama's structured output. */
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answerable: { type: "boolean" },
    answer: { type: "string" },
    citations: {
      type: "array",
      items: { type: "object", properties: { excerpt: { type: "integer" }, quote: { type: "string" } }, required: ["excerpt", "quote"] },
    },
  },
  required: ["answerable", "answer", "citations"],
};

async function ollama<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.OLLAMA_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new Error(`Can't reach Ollama at ${config.OLLAMA_URL}. Install it from https://ollama.com and make sure it's running.`);
  }
  if (!res.ok) throw new Error(`Ollama ${path} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export class OllamaGenerator implements AnswerGenerator {
  readonly name: string;
  constructor(private model = config.LOCAL_MODEL ?? "qwen2.5:7b") {
    this.name = `ollama:${model}`;
  }

  async generate(question: string, chunks: RetrievedChunk[]): Promise<AnswerToolInput> {
    const res = await ollama<{ message: { content: string } }>("/api/chat", {
      model: this.model,
      stream: false,
      format: ANSWER_SCHEMA,
      // Six passages plus instructions run ~2-3k tokens; older Ollama defaults (2048) cut them off.
      options: { temperature: 0, num_ctx: 8192 },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(question, chunks) },
      ],
    });
    // Small local models sometimes wrap JSON in prose; take the outermost object.
    const text = res.message.content;
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return AnswerToolInput.parse(JSON.parse(json));
  }
}

/**
 * Local embeddings. Models like nomic-embed-text return fewer than 1536 dimensions; the
 * vector is zero-padded to fit the shared column, which leaves cosine similarity unchanged.
 */
export class OllamaEmbedder implements Embedder {
  readonly name: string;
  readonly minSimilarity = 0.35;
  constructor(private model = config.LOCAL_EMBEDDING_MODEL ?? "nomic-embed-text") {
    this.name = `ollama:${model}`;
  }

  async embed(texts: string[], role?: "query" | "document"): Promise<number[][]> {
    // nomic-embed-text is trained with task prefixes; without them retrieval quality drops.
    const prefix = this.model.startsWith("nomic-embed") && role ? (role === "query" ? "search_query: " : "search_document: ") : "";
    if (prefix) texts = texts.map((t) => prefix + t);
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const { embeddings } = await ollama<{ embeddings: number[][] }>("/api/embed", { model: this.model, input: texts.slice(i, i + 64) });
      for (const e of embeddings) {
        if (e.length > EMBEDDING_DIMENSIONS) throw new Error(`${this.model} returns ${e.length} dimensions; the column holds ${EMBEDDING_DIMENSIONS}.`);
        out.push(e.length === EMBEDDING_DIMENSIONS ? e : [...e, ...new Array(EMBEDDING_DIMENSIONS - e.length).fill(0)]);
      }
    }
    return out;
  }
}
