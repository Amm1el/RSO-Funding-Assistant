import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaEmbedder, OllamaGenerator } from "../src/ollama.js";
import { finalizeAnswer } from "../src/citations.js";
import type { RetrievedChunk } from "../src/types.js";

const chunk: RetrievedChunk = {
  id: 1, ordinal: 0, section: "LODGING", pageStart: 12, pageEnd: 12, similarity: 0.6, title: "2026-27 RSO Financial Manual",
  content: "Daily hotel rate should not exceed $225 per night (before tax). Each room is expected to host four travelers.",
};

describe("Ollama (local AI, no API key)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks for structured JSON and the answer passes the same citation check", async () => {
    let sent: any;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      // Small models sometimes add prose around the JSON.
      return new Response(JSON.stringify({ message: { content: 'Here you go: {"answerable":true,"answer":"Up to $225 a night.","citations":[{"excerpt":1,"quote":"should not exceed $225 per night"}]}' } }));
    });
    const raw = await new OllamaGenerator("qwen2.5:7b").generate("hotel limit?", [chunk]);
    expect(sent.url).toBe("http://localhost:11434/api/chat");
    expect(sent.body).toMatchObject({ model: "qwen2.5:7b", stream: false, options: { temperature: 0 } });
    expect(sent.body.format.required).toEqual(["answerable", "answer", "citations"]);
    expect(sent.body.messages[1].content).toContain("Source: 2026-27 RSO Financial Manual");
    expect(finalizeAnswer(raw, [chunk])).toMatchObject({ answerable: true, citations: [{ section: "LODGING", pages: "12" }] });
  });

  it("explains how to fix it when Ollama isn't running", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(new OllamaGenerator().generate("q", [chunk])).rejects.toThrow(/ollama\.com/);
  });

  it("zero-pads smaller embeddings to the shared 1536-dimension column", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ embeddings: [new Array(768).fill(0.5)] })));
    const [v] = await new OllamaEmbedder("nomic-embed-text").embed(["hello"]);
    expect(v).toHaveLength(1536);
    expect(v[767]).toBe(0.5);
    expect(v[768]).toBe(0);
  });

  it("adds nomic's task prefixes for questions and passages, and leaves other models alone", async () => {
    const sent: string[][] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push(body.input);
      return new Response(JSON.stringify({ embeddings: body.input.map(() => [1, 0]) }));
    });
    await new OllamaEmbedder("nomic-embed-text").embed(["How much for hotels?"], "query");
    await new OllamaEmbedder("nomic-embed-text").embed(["Lodging: $225 a night"], "document");
    await new OllamaEmbedder("mxbai-embed-large").embed(["How much for hotels?"], "query");
    expect(sent).toEqual([["search_query: How much for hotels?"], ["search_document: Lodging: $225 a night"], ["How much for hotels?"]]);
  });

  it("zero-padding keeps cosine similarity unchanged", async () => {
    const a = [0.3, -0.2, 0.9], b = [0.1, 0.4, 0.8];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => new Response(JSON.stringify({ embeddings: JSON.parse(String(init.body)).input.map((t: string) => (t === "a" ? a : b)) })));
    const [pa, pb] = await new OllamaEmbedder("x").embed(["a", "b"]);
    const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0) / (Math.hypot(...x) * Math.hypot(...y));
    expect(cos(pa, pb)).toBeCloseTo(cos(a, b), 12);
  });

  it("is used when USE_AI is on with a local model and no API key", async () => {
    vi.resetModules();
    vi.stubEnv("USE_AI", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("LOCAL_MODEL", "llama3.2:3b");
    vi.stubEnv("LOCAL_EMBEDDING_MODEL", "nomic-embed-text");
    const { createGenerator, allowedProviders } = await import("../src/runtime.js");
    const { defaultEmbedder } = await import("../src/embeddings.js");
    expect(createGenerator().name).toBe("ollama:llama3.2:3b");
    expect(defaultEmbedder().name).toBe("ollama:nomic-embed-text");
    expect(allowedProviders()).toEqual(["ollama", "hash"]);
    vi.resetModules();
  });
});
