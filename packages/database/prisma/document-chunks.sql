CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "DocumentChunk" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "documentId" TEXT NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  tokens INT,
  embedding vector(1536),
  metadata JSONB,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_idx"
ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "DocumentChunk_documentId_idx"
ON "DocumentChunk" ("documentId");

CREATE INDEX IF NOT EXISTS "DocumentChunk_content_fts_idx"
ON "DocumentChunk" USING gin (to_tsvector('simple', content));
