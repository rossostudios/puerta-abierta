-- Phase 6: Agent knowledge base foundation

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_org
  ON knowledge_documents(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org_doc
  ON knowledge_chunks(organization_id, document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org_created
  ON knowledge_chunks(organization_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_knowledge_documents_updated_at'
  ) THEN
    CREATE TRIGGER trg_knowledge_documents_updated_at
      BEFORE UPDATE ON knowledge_documents
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_knowledge_chunks_updated_at'
  ) THEN
    CREATE TRIGGER trg_knowledge_chunks_updated_at
      BEFORE UPDATE ON knowledge_chunks
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'knowledge_documents'
      AND policyname = 'knowledge_documents_org_member_all'
  ) THEN
    CREATE POLICY knowledge_documents_org_member_all
      ON knowledge_documents FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'knowledge_chunks'
      AND policyname = 'knowledge_chunks_org_member_all'
  ) THEN
    CREATE POLICY knowledge_chunks_org_member_all
      ON knowledge_chunks FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END $$;
