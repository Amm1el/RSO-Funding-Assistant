-- One row per ingested manual (lets us keep 2025-26 and 2026-27 side by side later).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  version     TEXT NOT NULL,
  source_file TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (title, version)
);

-- One row per chunk of manual text, with its embedding.
CREATE TABLE IF NOT EXISTS chunks (
  id          SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  section     TEXT NOT NULL,
  page_start  INTEGER NOT NULL,
  page_end    INTEGER NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(1536) NOT NULL,
  UNIQUE (document_id, ordinal)
);

-- Approximate nearest-neighbor index for cosine distance.
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);
