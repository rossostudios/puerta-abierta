-- Fix agent memory: add UNIQUE constraint for upsert and GIN indexes for ILIKE queries

-- Deduplicate existing rows before adding constraint (keep most recent per key)
DELETE FROM agent_memory a
USING agent_memory b
WHERE a.organization_id = b.organization_id
  AND a.agent_slug = b.agent_slug
  AND a.memory_key = b.memory_key
  AND a.updated_at < b.updated_at;

-- Add UNIQUE constraint so ON CONFLICT works correctly
ALTER TABLE agent_memory
  ADD CONSTRAINT agent_memory_org_slug_key_unique
  UNIQUE (organization_id, agent_slug, memory_key);

-- Enable pg_trgm for trigram indexes (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes for ILIKE '%query%' searches
CREATE INDEX IF NOT EXISTS idx_agent_memory_key_trgm
  ON agent_memory USING gin (memory_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agent_memory_value_trgm
  ON agent_memory USING gin (memory_value gin_trgm_ops);
