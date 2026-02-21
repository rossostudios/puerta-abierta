-- Agent evaluations table for confidence feedback loop.
-- Records approval/rejection outcomes to improve agent confidence scoring.
CREATE TABLE IF NOT EXISTS agent_evaluations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent_slug  text NOT NULL,
    outcome     text NOT NULL CHECK (outcome IN ('approved', 'rejected')),
    approval_id uuid REFERENCES agent_approvals(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_evaluations_slug_created
    ON agent_evaluations (agent_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_evaluations_org
    ON agent_evaluations (organization_id);

-- RLS
ALTER TABLE agent_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_evaluations_org_access ON agent_evaluations
    FOR ALL
    USING (organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
    ));
