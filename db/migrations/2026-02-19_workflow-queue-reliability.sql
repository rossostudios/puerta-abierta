-- Workflow reliability foundation: durable jobs, attempts, round-robin state.
-- Also hardens sequence enrollment dedupe and trigger constraint alignment.

-- Extend workflow enums (idempotent)
ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'task_completed';
ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'payment_received';
ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'lease_expiring';
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'send_whatsapp';
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'assign_task_round_robin';

-- Durable workflow jobs queue
CREATE TABLE IF NOT EXISTS workflow_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_rule_id uuid REFERENCES workflow_rules(id) ON DELETE CASCADE,
  trigger_event text NOT NULL,
  action_type text NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  dedupe_key text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_job_id uuid NOT NULL REFERENCES workflow_jobs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'skipped')),
  reason text,
  normalized_action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_round_robin_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_rule_id uuid NOT NULL REFERENCES workflow_rules(id) ON DELETE CASCADE,
  role text NOT NULL,
  last_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  cursor_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workflow_rule_id, role)
);

CREATE INDEX IF NOT EXISTS idx_workflow_jobs_status_run_at
  ON workflow_jobs(status, run_at);
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_org_status_run
  ON workflow_jobs(organization_id, status, run_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_jobs_dedupe_key
  ON workflow_jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_job_attempts_job_attempt
  ON workflow_job_attempts(workflow_job_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_job_attempts_org_created
  ON workflow_job_attempts(organization_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_workflow_jobs_updated_at'
      AND tgrelid = 'workflow_jobs'::regclass
  ) THEN
    CREATE TRIGGER trg_workflow_jobs_updated_at
      BEFORE UPDATE ON workflow_jobs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_workflow_round_robin_state_updated_at'
      AND tgrelid = 'workflow_round_robin_state'::regclass
  ) THEN
    CREATE TRIGGER trg_workflow_round_robin_state_updated_at
      BEFORE UPDATE ON workflow_round_robin_state
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

ALTER TABLE workflow_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_round_robin_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workflow_jobs'
      AND policyname = 'workflow_jobs_org_member_all'
  ) THEN
    CREATE POLICY workflow_jobs_org_member_all
      ON workflow_jobs FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workflow_job_attempts'
      AND policyname = 'workflow_job_attempts_org_member_all'
  ) THEN
    CREATE POLICY workflow_job_attempts_org_member_all
      ON workflow_job_attempts FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workflow_round_robin_state'
      AND policyname = 'workflow_round_robin_state_org_member_all'
  ) THEN
    CREATE POLICY workflow_round_robin_state_org_member_all
      ON workflow_round_robin_state FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END
$$;

-- Sequence enrollment dedupe safety (active-only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sequence_enrollments_active_dedupe
  ON sequence_enrollments(sequence_id, entity_type, entity_id, recipient)
  WHERE status = 'active';

-- Keep sequence trigger constraint explicit and aligned with current backend behavior.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'communication_sequences'::regclass
      AND conname = 'communication_sequences_trigger_type_check'
  ) THEN
    ALTER TABLE communication_sequences
      DROP CONSTRAINT communication_sequences_trigger_type_check;
  END IF;

  ALTER TABLE communication_sequences
    ADD CONSTRAINT communication_sequences_trigger_type_check
    CHECK (trigger_type IN (
      'reservation_confirmed',
      'checked_in',
      'checked_out',
      'lease_created',
      'lease_activated',
      'lease_expiring',
      'manual'
    ));
END
$$;
