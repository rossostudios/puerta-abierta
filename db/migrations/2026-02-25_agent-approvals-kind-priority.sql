-- Add missing agent_approvals queue classification fields used by approvals UI/API.
-- Idempotent and safe for existing rows.

ALTER TABLE agent_approvals
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS priority text;

UPDATE agent_approvals
SET kind = 'mutation'
WHERE kind IS NULL OR btrim(kind) = '';

UPDATE agent_approvals
SET priority = 'medium'
WHERE priority IS NULL OR btrim(priority) = '';

ALTER TABLE agent_approvals
  ALTER COLUMN kind SET DEFAULT 'mutation',
  ALTER COLUMN priority SET DEFAULT 'medium';

DO $$
BEGIN
  ALTER TABLE agent_approvals
    DROP CONSTRAINT IF EXISTS agent_approvals_kind_check;
  ALTER TABLE agent_approvals
    DROP CONSTRAINT IF EXISTS agent_approvals_priority_check;

  ALTER TABLE agent_approvals
    ADD CONSTRAINT agent_approvals_kind_check
      CHECK (kind IN ('guest_reply', 'mutation', 'financial', 'maintenance', 'leasing', 'notification', 'other'));

  ALTER TABLE agent_approvals
    ADD CONSTRAINT agent_approvals_priority_check
      CHECK (priority IN ('low', 'medium', 'high', 'critical'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE agent_approvals
  ALTER COLUMN kind SET NOT NULL,
  ALTER COLUMN priority SET NOT NULL;
