-- Safe to run repeatedly: every statement is idempotent.
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per ingested manual (lets us keep 2025-26 and 2026-27 side by side).
CREATE TABLE IF NOT EXISTS documents (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  version     TEXT NOT NULL,
  source_file TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (title, version)
);

-- Which embedding model built this document's vectors. Questions must be embedded
-- with the same model, or the similarity scores are meaningless.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedder TEXT NOT NULL DEFAULT 'openai:text-embedding-3-small';

-- The same manual can be ingested once per embedder (offline and OpenAI side by side),
-- so turning USE_AI on or off switches instantly without re-ingesting.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_title_version_key;
CREATE UNIQUE INDEX IF NOT EXISTS documents_title_version_embedder ON documents (title, version, embedder);

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

-- Full-text search vector for the keyword half of hybrid search. Postgres keeps it
-- in sync automatically because it's a generated column. Slashes become spaces because
-- Postgres's parser reads "Uber/Lyft" as one file-path token, so "uber" never matched.
-- Databases created by an older schema have the column without replace(); drop and re-add it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'chunks' AND column_name = 'tsv'
       AND generation_expression NOT LIKE '%replace%'
  ) THEN
    ALTER TABLE chunks DROP COLUMN tsv;
  END IF;
END $$;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', section || ' ' || replace(content, '/', ' '))) STORED;

CREATE INDEX IF NOT EXISTS chunks_tsv_gin ON chunks USING gin (tsv);
