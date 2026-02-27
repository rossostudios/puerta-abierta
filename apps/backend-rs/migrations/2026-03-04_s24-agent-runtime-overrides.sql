CREATE TABLE IF NOT EXISTS agent_runtime_overrides (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_slug text NOT NULL,
  is_active boolean,
  model_override text,
  max_steps_override integer CHECK (max_steps_override IS NULL OR max_steps_override BETWEEN 1 AND 24),
  allow_mutations_default boolean,
  guardrail_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, agent_slug)
);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_overrides_org_slug
  ON agent_runtime_overrides (organization_id, agent_slug);

ALTER TABLE agent_runtime_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON agent_runtime_overrides;
CREATE POLICY org_isolation ON agent_runtime_overrides
  USING (organization_id::text = current_setting('request.org_id', true))
  WITH CHECK (organization_id::text = current_setting('request.org_id', true));
