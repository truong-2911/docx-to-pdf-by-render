-- This is the SQL code to create the documents and document_embeddings tables
-- and the HNSW index on the document_embeddings table.

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zc_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document embeddings table
CREATE TABLE document_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding VECTOR(512) NOT NULL
);

-- HNSW index using cosine similarity
CREATE INDEX ON document_embeddings USING hnsw (embedding vector_cosine_ops);

-- Function to match documents
create or replace function match_documents (
  query_embedding vector(512),
  match_threshold float,
  match_count int
)
returns setof documents
language sql
as $$
  select d.*
  from document_embeddings de
  join documents d on d.id = de.document_id
  where (de.embedding <=> query_embedding) < 1 - match_threshold
  order by de.embedding <=> query_embedding asc
  limit least(match_count, 200);
$$;

-- Trigger to update `updated_at` on changes
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_documents_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
