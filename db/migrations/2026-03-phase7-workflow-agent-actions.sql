-- Phase 7: Workflow triggers and actions for agent playbooks

DO $$
BEGIN
  BEGIN ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'anomaly_detected'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'task_overdue_24h'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'application_stalled_48h'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'lease_expiring_30d'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'owner_statement_ready'; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

DO $$
BEGIN
  BEGIN ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'run_agent_playbook'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'request_agent_approval'; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Enable new read-only domain tools for active agents.
UPDATE ai_agents
SET allowed_tools = allowed_tools || '["get_today_ops_brief"]'::jsonb
WHERE is_active = TRUE
  AND NOT (allowed_tools @> '["get_today_ops_brief"]'::jsonb);

UPDATE ai_agents
SET allowed_tools = allowed_tools || '["get_lease_risk_summary"]'::jsonb
WHERE is_active = TRUE
  AND NOT (allowed_tools @> '["get_lease_risk_summary"]'::jsonb);

UPDATE ai_agents
SET allowed_tools = allowed_tools || '["get_collections_risk"]'::jsonb
WHERE is_active = TRUE
  AND NOT (allowed_tools @> '["get_collections_risk"]'::jsonb);

UPDATE ai_agents
SET allowed_tools = allowed_tools || '["get_owner_statement_summary"]'::jsonb
WHERE is_active = TRUE
  AND NOT (allowed_tools @> '["get_owner_statement_summary"]'::jsonb);

UPDATE ai_agents
SET allowed_tools = allowed_tools || '["search_knowledge"]'::jsonb
WHERE is_active = TRUE
  AND NOT (allowed_tools @> '["search_knowledge"]'::jsonb);
