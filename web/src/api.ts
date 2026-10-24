// Mirrors the server's JSON (src/pipeline.ts AskResult, src/server.ts, src/corpus/directory.ts).
export interface Citation {
  chunkId: number;
  section: string;
  pages: string;
  quote: string;
  title?: string;
  url?: string;
  collection?: string;
}

export interface Passage {
  id: number;
  section: string;
  pageStart: number;
  pageEnd: number;
  content: string;
  similarity: number;
  title?: string;
  url?: string;
  collection?: string;
}

export interface AskResponse {
  answerable: boolean;
  answer: string;
  citations: Citation[];
  passages: Passage[];
  generator: string;
}

export interface Collection {
  id: string;
  label: string;
  blurb: string;
  chunks: number;
}

export interface Health {
  ok: boolean;
  sources: number;
  chunks: number;
  updatedAt: string | null;
  embedder: string;
  generator: string;
}

export interface Contact {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  collection: string;
  source: { title: string; url: string };
}

export interface Place {
  name: string;
  usedBy: string[];
  meetings: number;
  lastMeeting: string;
  online: boolean;
}

export interface UpcomingMeeting {
  title: string;
  category: string;
  date: string;
  where?: string;
  url: string;
}

export interface EditionChange {
  title: string;
  newUrl: string;
  oldUrl: string;
  added: string[];
  removed: string[];
}

export interface Directory {
  contacts: Contact[];
  places: Place[];
  upcoming?: UpcomingMeeting[];
  changes?: EditionChange[];
  builtAt: string | null;
}

/** In the static (phone) build there is no server: the pipeline runs in the page. */
const STATIC = import.meta.env.MODE === "static";
const engine = () => import("./engine");

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch {
    throw new Error("Couldn't reach the assistant. Check that the server is running, then reload.");
  }
  if (!res.ok) throw new Error(`The server returned an error (${res.status}). Reload in a moment.`);
  return res.json();
}

export async function askQuestion(question: string, collection: string | null, signal?: AbortSignal): Promise<AskResponse> {
  if (STATIC) return (await engine()).askLocally(question, collection);
  let res: Response;
  try {
    res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, collection }),
      signal,
    });
  } catch {
    throw new Error("Couldn't reach the assistant. Check that the server is running, then ask again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server returned an error (${res.status}). Ask again in a moment.`);
  return body as AskResponse;
}

/** The phone build has no server, so it can't collect feedback. */
export const FEEDBACK_ENABLED = !STATIC;

export async function sendFeedback(body: {
  question: string;
  collection: string | null;
  answer: string;
  helpful: boolean;
  note?: string;
  generator: string;
  sections: string[];
}): Promise<void> {
  const res = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not send feedback.");
}

export async function fetchHealth(): Promise<Health> {
  return STATIC ? (await engine()).localHealth() : getJson("/health");
}

export async function fetchCollections(): Promise<Collection[]> {
  return STATIC ? (await engine()).localCollections() : getJson("/api/collections");
}

export async function fetchDirectory(): Promise<Directory> {
  return STATIC ? (await engine()).localDirectory() : getJson("/api/directory");
}

export const pageLabel = (start: number, end: number) => (!start ? "" : start === end ? `page ${start}` : `pages ${start}–${end}`);
