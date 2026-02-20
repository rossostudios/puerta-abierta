-- Phase 5: Approval-first governance
-- - Extends agent_approvals lifecycle and execution persistence
-- - Adds agent_approval_policies with org-level defaults

CREATE TABLE IF NOT EXISTS agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  chat_id UUID REFERENCES ai_chats(id) ON DELETE SET NULL,
  agent_slug TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'execution_failed')),
  requested_by UUID,
  reviewed_by UUID,
  review_note TEXT,
  execution_result JSONB,
  execution_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ
);

ALTER TABLE agent_approvals
  ADD COLUMN IF NOT EXISTS execution_result JSONB,
  ADD COLUMN IF NOT EXISTS execution_key TEXT,
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE agent_approvals DROP CONSTRAINT IF EXISTS agent_approvals_status_check;
  ALTER TABLE agent_approvals
    ADD CONSTRAINT agent_approvals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'execution_failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_approvals_org_status
  ON agent_approvals(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_chat
  ON agent_approvals(chat_id)
  WHERE chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_approvals_tool_status
  ON agent_approvals(organization_id, tool_name, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_approvals_execution_key
  ON agent_approvals(execution_key)
  WHERE execution_key IS NOT NULL;

ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_approvals'
      AND policyname = 'org_members_can_read_approvals'
  ) THEN
    CREATE POLICY org_members_can_read_approvals
      ON agent_approvals FOR SELECT
      USING (
        organization_id IN (
          SELECT organization_id
          FROM organization_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_approvals'
      AND policyname = 'operators_can_manage_approvals'
  ) THEN
    CREATE POLICY operators_can_manage_approvals
      ON agent_approvals FOR ALL
      USING (
        organization_id IN (
          SELECT organization_id
          FROM organization_members
          WHERE user_id = auth.uid()
            AND role IN ('owner_admin', 'operator', 'accountant')
        )
      )
      WITH CHECK (
        organization_id IN (
          SELECT organization_id
          FROM organization_members
          WHERE user_id = auth.uid()
            AND role IN ('owner_admin', 'operator', 'accountant')
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_approval_policies (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL CHECK (tool_name IN ('create_row', 'update_row', 'delete_row')),
  approval_mode TEXT NOT NULL DEFAULT 'required' CHECK (approval_mode IN ('required', 'auto')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_approval_policies_org
  ON agent_approval_policies(organization_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_agent_approval_policies_updated_at'
  ) THEN
    CREATE TRIGGER trg_agent_approval_policies_updated_at
      BEFORE UPDATE ON agent_approval_policies
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE agent_approval_policies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_approval_policies'
      AND policyname = 'org_members_can_read_approval_policies'
  ) THEN
    CREATE POLICY org_members_can_read_approval_policies
      ON agent_approval_policies FOR SELECT
      USING (
        organization_id IN (
          SELECT organization_id
          FROM organization_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_approval_policies'
      AND policyname = 'operators_can_manage_approval_policies'
  ) THEN
    CREATE POLICY operators_can_manage_approval_policies
      ON agent_approval_policies FOR ALL
      USING (
        organization_id IN (
          SELECT organization_id
          FROM organization_members
          WHERE user_id = auth.uid()
            AND role IN ('owner_admin', 'operator', 'accountant')
        )
      )
      WITH CHECK (
        organization_id IN (
          SELECT organization_id
          FROM organization_members
          WHERE user_id = auth.uid()
            AND role IN ('owner_admin', 'operator', 'accountant')
        )
      );
  END IF;
END $$;

INSERT INTO agent_approval_policies (organization_id, tool_name, approval_mode, enabled)
SELECT o.id, t.tool_name, 'required', true
FROM organizations o
CROSS JOIN (
  VALUES
    ('create_row'),
    ('update_row'),
    ('delete_row')
) AS t(tool_name)
ON CONFLICT (organization_id, tool_name) DO NOTHING;
