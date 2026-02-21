-- Usage events table for metering agent calls, messages, and other billable actions.
CREATE TABLE IF NOT EXISTS usage_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type text NOT NULL,          -- e.g. 'agent_call', 'message_sent'
    quantity bigint NOT NULL DEFAULT 1,
    billing_period text NOT NULL,      -- e.g. '2026-02'
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_org_period
    ON usage_events (organization_id, billing_period);
CREATE INDEX IF NOT EXISTS idx_usage_events_type_period
    ON usage_events (event_type, billing_period);

-- RLS
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_events_org_rls ON usage_events
    USING (organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
    ));
