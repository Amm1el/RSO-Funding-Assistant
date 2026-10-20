/** A piece of manual text ready to embed and store. */
export interface Chunk {
  ordinal: number;
  section: string;
  pageStart: number;
  pageEnd: number;
  content: string;
}

/** A chunk returned by retrieval, with its cosine similarity to the question. */
export interface RetrievedChunk extends Chunk {
  id: number;
  similarity: number;
}

export interface Citation {
  chunkId: number;
  section: string;
  pages: string;
  quote: string;
}

export interface Answer {
  answerable: boolean;
  answer: string;
  citations: Citation[];
}
