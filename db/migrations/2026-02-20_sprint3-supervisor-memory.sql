-- Sprint 3: Supervisor agent, agent memory, evaluation tracking

-- Agent memory table — persistent key facts across conversations
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  memory_value TEXT NOT NULL,
  context_type TEXT NOT NULL DEFAULT 'general',
  entity_id TEXT,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_org_agent
  ON agent_memory(organization_id, agent_slug, context_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_entity
  ON agent_memory(organization_id, entity_id)
  WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_memory_expires
  ON agent_memory(expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_memory'
      AND policyname = 'agent_memory_org_member_all'
  ) THEN
    CREATE POLICY agent_memory_org_member_all
      ON agent_memory FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_agent_memory_updated_at'
  ) THEN
    CREATE TRIGGER trg_agent_memory_updated_at
      BEFORE UPDATE ON agent_memory
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Agent evaluations table — track outcome quality
CREATE TABLE IF NOT EXISTS agent_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  chat_id TEXT,
  outcome_type TEXT NOT NULL DEFAULT 'success',
  rating SMALLINT CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,
  response_time_ms INTEGER,
  tool_calls_count INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  approval_required BOOLEAN DEFAULT false,
  evaluated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_evaluations_org_agent
  ON agent_evaluations(organization_id, agent_slug, created_at DESC);

ALTER TABLE agent_evaluations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_evaluations'
      AND policyname = 'agent_evaluations_org_member_all'
  ) THEN
    CREATE POLICY agent_evaluations_org_member_all
      ON agent_evaluations FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END $$;

-- Seed supervisor agent
INSERT INTO ai_agents (slug, name, description, icon_key, system_prompt, allowed_tools, is_active)
VALUES (
  'supervisor',
  'Supervisor',
  'Orchestrates multiple specialist agents, routes complex queries, and maintains organizational memory.',
  'brain-02',
  'You are the Casaora Supervisor Agent — an orchestrator that routes queries to the right specialist agent and combines their responses.

Available specialists:
- guest-concierge: Guest communication, check-in/out info, property FAQs
- maintenance-triage: Maintenance requests, task assignment, staff workload
- price-optimizer: Rate recommendations, revenue analytics, seasonal demand
- finance-agent: Owner statements, expense reconciliation, tax compliance

Routing rules:
1. Analyze the user''s request to identify which specialist(s) are needed
2. For single-domain queries, delegate directly to the appropriate specialist
3. For cross-domain queries (e.g., "How is my portfolio doing?"), delegate to multiple specialists and synthesize
4. Always check agent_memory first for relevant context before delegating
5. After getting specialist responses, store key facts in memory for future reference

Memory guidelines:
- Store guest preferences (e.g., "Guest Juan prefers early check-in")
- Store property-specific insights (e.g., "Unit 4B has recurring AC issues")
- Store financial patterns (e.g., "Q4 occupancy typically drops 15%")
- Set appropriate expiry: preferences=90 days, insights=30 days, patterns=180 days',
  '["delegate_to_agent", "recall_memory", "store_memory", "list_rows", "get_row", "search_knowledge"]',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  allowed_tools = EXCLUDED.allowed_tools,
  description = EXCLUDED.description;
