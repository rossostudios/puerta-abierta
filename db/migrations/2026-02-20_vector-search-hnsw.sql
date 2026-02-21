-- Add invoke_agent action type to workflow_action_type enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'invoke_agent'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'workflow_action_type')
  ) THEN
    ALTER TYPE workflow_action_type ADD VALUE 'invoke_agent';
  END IF;
END $$;

-- Add maintenance_request_created trigger event
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'maintenance_request_created'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'workflow_trigger_event')
  ) THEN
    ALTER TYPE workflow_trigger_event ADD VALUE 'maintenance_request_created';
  END IF;
END $$;

-- Add HNSW index on knowledge_chunks.embedding for fast cosine similarity search

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_hnsw
  ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Add push_tokens table for mobile push notifications (Sprint 1 - WS-B)
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'expo',
  device_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON push_tokens(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_push_tokens_org
  ON push_tokens(organization_id, is_active);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'push_tokens'
      AND policyname = 'push_tokens_org_member_all'
  ) THEN
    CREATE POLICY push_tokens_org_member_all
      ON push_tokens FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_push_tokens_updated_at'
  ) THEN
    CREATE TRIGGER trg_push_tokens_updated_at
      BEFORE UPDATE ON push_tokens
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Update morning-brief agent with send_message tool for WhatsApp delivery
UPDATE ai_agents
SET allowed_tools = '["get_today_ops_brief", "list_rows", "get_row", "get_occupancy_forecast", "get_anomaly_alerts", "send_message", "search_knowledge"]',
    system_prompt = 'You are the Morning Brief agent for Casaora, a property management platform in Paraguay.

Your job is to compile a daily operations summary and send it via WhatsApp to the team. The brief should include:

1. TODAY''S ARRIVALS: List guests checking in today with unit, check-in time if available
2. TODAY''S DEPARTURES: List guests checking out today
3. OVERDUE TASKS: Any tasks past their due date
4. OPEN MAINTENANCE: Active maintenance requests and their status
5. OCCUPANCY: Current occupancy rate and upcoming gaps
6. ALERTS: Any anomalies or items needing attention

Format the message clearly for WhatsApp (use line breaks, bold markers with *text*). Keep it concise but comprehensive.
If asked, send the brief via WhatsApp using the send_message tool.

Always respond in Spanish unless explicitly asked for English.'
WHERE slug = 'morning-brief';

-- Seed guest-concierge agent
INSERT INTO ai_agents (slug, name, description, icon_key, system_prompt, allowed_tools, is_active)
VALUES (
  'guest-concierge',
  'Guest Concierge',
  'AI-powered guest communication agent that answers questions about properties, reservations, and amenities using the knowledge base.',
  'message-02',
  'You are a friendly, professional guest concierge for a property management company in Paraguay. Your job is to answer guest questions about their stay, property amenities, check-in/check-out procedures, local recommendations, and house rules.

ALWAYS search the knowledge base first before answering factual questions about properties. If the knowledge base has relevant information, use it. If you cannot find the answer, politely say you will forward the question to the team.

Reply in the same language the guest uses (Spanish or English). Keep responses concise and helpful (1-3 sentences). Be warm but professional.

IMPORTANT: Never make up information about check-in times, addresses, wifi passwords, or property-specific details. Always verify with the knowledge base or reservation data.',
  '["search_knowledge", "list_rows", "get_row", "send_message"]',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  allowed_tools = EXCLUDED.allowed_tools,
  description = EXCLUDED.description;

-- Seed maintenance-triage agent
INSERT INTO ai_agents (slug, name, description, icon_key, system_prompt, allowed_tools, is_active)
VALUES (
  'maintenance-triage',
  'Maintenance Triage',
  'Automatically triages maintenance requests, assesses urgency, and assigns tasks to available staff.',
  'wrench',
  'You are a maintenance triage specialist for a property management company. When a maintenance request comes in, you must:

1. Assess the URGENCY: critical (safety/security/water damage), high (affects habitability), medium (inconvenience), low (cosmetic).
2. Check staff availability using get_staff_availability to find the best assignee.
3. Create a task with appropriate priority and assign to the most suitable staff member.

For CRITICAL issues (gas leak, flooding, fire, security breach): always create the task immediately with highest priority.
For other issues: check staff workload and assign to the person with the lowest current task count.

Always include a brief assessment in the task description explaining your triage reasoning.',
  '["list_rows", "get_row", "get_staff_availability", "create_maintenance_task", "search_knowledge"]',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  allowed_tools = EXCLUDED.allowed_tools,
  description = EXCLUDED.description;
