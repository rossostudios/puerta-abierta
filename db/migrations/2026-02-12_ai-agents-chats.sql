-- Migration: AI agents + persistent chats V1
-- Date: 2026-02-12
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  icon_key text NOT NULL DEFAULT 'SparklesIcon',
  system_prompt text NOT NULL,
  allowed_tools jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allowed_tools) = 'array'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_active_slug
  ON ai_agents(is_active, slug);

CREATE TABLE IF NOT EXISTS ai_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE RESTRICT,
  title text NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chats_org_user_archived_last
  ON ai_chats(organization_id, created_by_user_id, is_archived, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_chats_agent_id
  ON ai_chats(agent_id);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  tool_trace jsonb,
  model_used text,
  fallback_used boolean NOT NULL DEFAULT false,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_chat_created
  ON ai_chat_messages(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_org_user_created
  ON ai_chat_messages(organization_id, created_by_user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_agents_updated_at') THEN
    CREATE TRIGGER trg_ai_agents_updated_at
      BEFORE UPDATE ON ai_agents
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_chats_updated_at') THEN
    CREATE TRIGGER trg_ai_chats_updated_at
      BEFORE UPDATE ON ai_chats
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

INSERT INTO ai_agents (slug, name, description, icon_key, system_prompt, allowed_tools, is_active)
VALUES
  (
    'morning-brief',
    'Morning Brief',
    'Daily operations snapshot with priorities and risk flags for Paraguay STR teams.',
    'Sun03Icon',
    'You are Morning Brief for Casaora. Summarize today''s operations for short-term rentals in Paraguay. Focus on urgent turnovers, overdue tasks, today arrivals/departures, and collections risk. Keep output concise and ranked by priority.',
    '["list_tables", "get_org_snapshot", "list_rows", "get_row"]'::jsonb,
    true
  ),
  (
    'ops-dispatch',
    'Ops Dispatch',
    'Turnover and task dispatch specialist focused on SLA reliability.',
    'TaskDaily01Icon',
    'You are Ops Dispatch for Casaora. Diagnose operational bottlenecks, SLA breaches, and assignment gaps. Recommend immediate next actions for operators.',
    '["list_tables", "get_org_snapshot", "list_rows", "get_row", "create_row", "update_row"]'::jsonb,
    true
  ),
  (
    'leasing-funnel',
    'Leasing Funnel',
    'Application pipeline advisor from inquiry to lease conversion.',
    'UserMultiple02Icon',
    'You are Leasing Funnel for Casaora. Analyze applications stages, response latency, qualification quality, and conversion blockers. Suggest concrete pipeline actions.',
    '["list_tables", "get_org_snapshot", "list_rows", "get_row", "create_row", "update_row"]'::jsonb,
    true
  ),
  (
    'collections-finance',
    'Collections Finance',
    'Collections and owner statement reconciliation copilot.',
    'Invoice03Icon',
    'You are Collections Finance for Casaora. Focus on late collections, expected cashflow, and owner statement consistency. Flag anomalies and explain likely causes.',
    '["list_tables", "get_org_snapshot", "list_rows", "get_row", "create_row", "update_row"]'::jsonb,
    true
  ),
  (
    'guest-comms',
    'Guest Communications',
    'Guest messaging assistant for concise and professional communication drafts.',
    'Message01Icon',
    'You are Guest Communications for Casaora. Draft concise bilingual responses (Spanish first) for guest and applicant communication. Suggest the best channel and follow-up timing.',
    '["list_tables", "list_rows", "get_row", "create_row"]'::jsonb,
    true
  ),
  (
    'marketplace-growth',
    'Marketplace Growth',
    'Marketplace listing quality and conversion optimization assistant.',
    'ChartLineData02Icon',
    'You are Marketplace Growth for Casaora. Analyze listing quality, transparency completeness, and conversion funnel signals. Recommend improvements for Paraguay rental demand.',
    '["list_tables", "get_org_snapshot", "list_rows", "get_row", "update_row"]'::jsonb,
    true
  )
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon_key = EXCLUDED.icon_key,
  system_prompt = EXCLUDED.system_prompt,
  allowed_tools = EXCLUDED.allowed_tools,
  is_active = EXCLUDED.is_active,
  updated_at = now();

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_agents' AND policyname = 'ai_agents_read_authenticated'
  ) THEN
    CREATE POLICY ai_agents_read_authenticated
      ON ai_agents FOR SELECT
      USING (auth_user_id() IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_chats' AND policyname = 'ai_chats_owner_all'
  ) THEN
    CREATE POLICY ai_chats_owner_all
      ON ai_chats FOR ALL
      USING (is_org_member(organization_id) AND created_by_user_id = auth_user_id())
      WITH CHECK (is_org_member(organization_id) AND created_by_user_id = auth_user_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_chat_messages' AND policyname = 'ai_chat_messages_owner_all'
  ) THEN
    CREATE POLICY ai_chat_messages_owner_all
      ON ai_chat_messages FOR ALL
      USING (is_org_member(organization_id) AND created_by_user_id = auth_user_id())
      WITH CHECK (is_org_member(organization_id) AND created_by_user_id = auth_user_id());
  END IF;
END $$;
