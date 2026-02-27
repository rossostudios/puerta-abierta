ALTER TABLE agent_traces
  ADD COLUMN IF NOT EXISTS llm_transport text NOT NULL DEFAULT 'responses',
  ADD COLUMN IF NOT EXISTS runtime_run_id text,
  ADD COLUMN IF NOT EXISTS runtime_trace_id text,
  ADD COLUMN IF NOT EXISTS is_shadow_run boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shadow_of_run_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_traces_llm_transport_check'
  ) THEN
    ALTER TABLE agent_traces
      ADD CONSTRAINT agent_traces_llm_transport_check
      CHECK (llm_transport IN ('responses', 'chat_completions'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_agent_traces_org_shadow_created
  ON agent_traces (organization_id, is_shadow_run, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_traces_org_transport_created
  ON agent_traces (organization_id, llm_transport, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_traces_runtime_run_id
  ON agent_traces (runtime_run_id)
  WHERE runtime_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_runtime_rollouts (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'canary'
    CHECK (mode IN ('v2', 'legacy', 'canary')),
  canary_percentage integer NOT NULL DEFAULT 100
    CHECK (canary_percentage BETWEEN 0 AND 100),
  shadow_enabled boolean NOT NULL DEFAULT true,
  shadow_percentage integer NOT NULL DEFAULT 25
    CHECK (shadow_percentage BETWEEN 0 AND 100),
  gate_enabled boolean NOT NULL DEFAULT true,
  gate_window_minutes integer NOT NULL DEFAULT 60
    CHECK (gate_window_minutes BETWEEN 5 AND 1440),
  gate_min_samples bigint NOT NULL DEFAULT 20
    CHECK (gate_min_samples >= 1),
  gate_max_error_rate double precision NOT NULL DEFAULT 0.15
    CHECK (gate_max_error_rate BETWEEN 0 AND 1),
  gate_max_mismatch_rate double precision NOT NULL DEFAULT 0.25
    CHECK (gate_max_mismatch_rate BETWEEN 0 AND 1),
  legacy_chat_cutoff_at timestamptz,
  legacy_chat_window_days integer NOT NULL DEFAULT 7
    CHECK (legacy_chat_window_days BETWEEN 1 AND 90),
  legacy_chat_max_calls bigint NOT NULL DEFAULT 0
    CHECK (legacy_chat_max_calls >= 0),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_rollouts_mode
  ON agent_runtime_rollouts (mode);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_agent_runtime_rollouts_updated_at'
  ) THEN
    CREATE TRIGGER trg_agent_runtime_rollouts_updated_at
      BEFORE UPDATE ON agent_runtime_rollouts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS agent_runtime_parity_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chat_id uuid REFERENCES ai_chats(id) ON DELETE SET NULL,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  agent_slug text NOT NULL,
  primary_transport text NOT NULL
    CHECK (primary_transport IN ('responses', 'chat_completions')),
  shadow_transport text NOT NULL
    CHECK (shadow_transport IN ('responses', 'chat_completions')),
  primary_run_id text NOT NULL,
  shadow_run_id text,
  primary_trace_id text,
  shadow_trace_id text,
  primary_model text,
  shadow_model text,
  primary_tool_count integer NOT NULL DEFAULT 0,
  shadow_tool_count integer,
  primary_success boolean NOT NULL DEFAULT true,
  shadow_success boolean,
  primary_fallback_used boolean NOT NULL DEFAULT false,
  shadow_fallback_used boolean,
  parity_status text NOT NULL DEFAULT 'pending'
    CHECK (parity_status IN ('pending', 'match', 'mismatch', 'shadow_error', 'skipped')),
  mismatch_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_reply_hash text,
  shadow_reply_hash text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_parity_org_created
  ON agent_runtime_parity_runs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_parity_org_status_created
  ON agent_runtime_parity_runs (organization_id, parity_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_parity_org_completed
  ON agent_runtime_parity_runs (organization_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runtime_parity_primary_run
  ON agent_runtime_parity_runs (primary_run_id);

ALTER TABLE agent_runtime_rollouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runtime_parity_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON agent_runtime_rollouts;
CREATE POLICY org_isolation ON agent_runtime_rollouts
  USING (organization_id::text = current_setting('request.org_id', true))
  WITH CHECK (organization_id::text = current_setting('request.org_id', true));

DROP POLICY IF EXISTS org_isolation ON agent_runtime_parity_runs;
CREATE POLICY org_isolation ON agent_runtime_parity_runs
  USING (organization_id::text = current_setting('request.org_id', true))
  WITH CHECK (organization_id::text = current_setting('request.org_id', true));
