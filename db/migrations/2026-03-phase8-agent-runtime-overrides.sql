-- Runtime overrides per organization for code-owned agent specs.
-- This table stores operational knobs only; prompts and tool contracts remain in code.

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

CREATE TRIGGER trg_agent_runtime_overrides_updated_at
  BEFORE UPDATE ON agent_runtime_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE agent_runtime_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_runtime_overrides_read_authenticated ON agent_runtime_overrides;
CREATE POLICY agent_runtime_overrides_read_authenticated
  ON agent_runtime_overrides FOR SELECT
  USING (
    organization_id::text IN (
      SELECT organization_id::text
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS agent_runtime_overrides_manage_org_roles ON agent_runtime_overrides;
CREATE POLICY agent_runtime_overrides_manage_org_roles
  ON agent_runtime_overrides FOR ALL
  USING (
    organization_id::text IN (
      SELECT organization_id::text
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role = ANY (ARRAY['owner_admin', 'operator'])
    )
  )
  WITH CHECK (
    organization_id::text IN (
      SELECT organization_id::text
      FROM organization_members
      WHERE user_id = auth.uid()
        AND role = ANY (ARRAY['owner_admin', 'operator'])
    )
  );
