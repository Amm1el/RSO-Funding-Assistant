import type { CorpusDoc } from "../crawl/types.js";
import { replaceCorpus, setMeta, type DbPool } from "../db.js";
import { buildDirectory } from "./directory.js";
import type { Embedder } from "../embeddings.js";
import { docToChunks, type DocChunks } from "./chunk.js";
import type { CollectionId } from "./collections.js";
import { betterTitle, dropNearDuplicates, sourceWeight } from "./authority.js";

export interface IngestSummary {
  documents: number;
  chunks: number;
  collections: Record<string, number>;
}

/** Chunks every source (pages first, so linked documents can inherit their page's section). */
export function chunkCorpus(input: CorpusDoc[], log: (m: string) => void = () => {}): DocChunks[] {
  const titled = input.map((d) => ({ ...d, title: betterTitle(d) }));
  const { kept: docs, dropped } = dropNearDuplicates(titled);
  if (dropped.length) log(`Dropped ${dropped.length} near-duplicate documents (older or repeated editions).`);
  const byParent = new Map<string, CollectionId>();
  const out: DocChunks[] = [];
  for (const doc of [...docs].sort((a, b) => Number(a.kind !== "page") - Number(b.kind !== "page"))) {
    const result = docToChunks(doc, { parentCollection: doc.parent ? byParent.get(doc.parent) : null });
    if (!result.chunks.length) continue;
    if (doc.kind === "page") byParent.set(doc.url, result.collection);
    out.push(result);
  }
  return out;
}

/** Chunks, embeds and stores a whole corpus for one embedder, replacing what was there. */
export async function ingestCorpus(pool: DbPool, docs: CorpusDoc[], embedder: Embedder, log: (m: string) => void = console.log): Promise<IngestSummary> {
  const chunked = chunkCorpus(docs, log);
  const total = chunked.reduce((s, d) => s + d.chunks.length, 0);
  log(`Chunked ${chunked.length} sources into ${total.toLocaleString()} chunks; embedding with ${embedder.name}...`);

  const items = [];
  let done = 0;
  for (const { doc, collection, chunks } of chunked) {
    // The title and section go into the embedding, so a question can match either.
    const embeddings = await embedder.embed(chunks.map((c) => `${doc.title}\n${c.section}\n${c.content}`));
    items.push({
      doc: { title: doc.title, url: doc.url, kind: doc.kind, collection, parent: doc.parent, fetchedAt: doc.fetchedAt, version: doc.fetchedAt.slice(0, 10), weight: sourceWeight(doc) },
      chunks,
      embeddings,
    });
    done += chunks.length;
    if (chunked.length > 50 && items.length % 200 === 0) log(`  embedded ${done.toLocaleString()} / ${total.toLocaleString()}`);
  }
  await replaceCorpus(pool, embedder.name, items);
  const directory = buildDirectory(docs);
  await setMeta(pool, "directory", directory);
  log(`Directory: ${directory.contacts.length} contacts, ${directory.places.length} meeting places`);

  const collections: Record<string, number> = {};
  for (const { chunks } of chunked) for (const c of chunks) collections[c.collection!] = (collections[c.collection!] ?? 0) + 1;
  log(`Stored ${chunked.length} sources, ${total.toLocaleString()} chunks: ${JSON.stringify(collections)}`);
  return { documents: chunked.length, chunks: total, collections };
}
