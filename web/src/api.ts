// Mirrors the JSON returned by POST /api/ask (see src/pipeline.ts AskResult).
export interface Citation {
  chunkId: number;
  section: string;
  pages: string;
  quote: string;
}

export interface Passage {
  id: number;
  section: string;
  pageStart: number;
  pageEnd: number;
  content: string;
  similarity: number;
}

export interface AskResponse {
  answerable: boolean;
  answer: string;
  citations: Citation[];
  passages: Passage[];
  generator: string;
}

/** In the static (phone) build there is no server: the pipeline runs in the page. */
const STATIC = import.meta.env.MODE === "static";

export async function askQuestion(question: string, signal?: AbortSignal): Promise<AskResponse> {
  if (STATIC) return (await import("./engine")).askLocally(question);
  let res: Response;
  try {
    res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal,
    });
  } catch {
    throw new Error("Couldn't reach the assistant. Check that the server is running, then ask again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server returned an error (${res.status}). Ask again in a moment.`);
  return body as AskResponse;
}

export const pageLabel = (start: number, end: number) => (start === end ? `page ${start}` : `pages ${start}–${end}`);

export interface Health {
  ok: boolean;
  manual?: string;
  chunks: number;
  embedder: string;
  generator: string;
}

export async function fetchHealth(): Promise<Health> {
  if (STATIC) return (await import("./engine")).localHealth();
  const res = await fetch("/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
}
