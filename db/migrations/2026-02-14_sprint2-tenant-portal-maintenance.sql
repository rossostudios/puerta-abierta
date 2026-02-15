-- Sprint 2: Tenant Portal + Maintenance Requests

-- ---------- Tenant Access Tokens (Magic Link Auth) ----------

CREATE TABLE tenant_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  email citext NOT NULL,
  phone_e164 text,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_access_tokens_lease
  ON tenant_access_tokens(lease_id);
CREATE INDEX idx_tenant_access_tokens_email
  ON tenant_access_tokens(email);
CREATE INDEX idx_tenant_access_tokens_hash
  ON tenant_access_tokens(token_hash);

CREATE TRIGGER trg_tenant_access_tokens_updated_at
  BEFORE UPDATE ON tenant_access_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- No RLS — tenant tokens are validated by the backend, not Supabase RLS.

-- ---------- Maintenance Requests ----------

CREATE TYPE maintenance_category AS ENUM (
  'plumbing',
  'electrical',
  'structural',
  'appliance',
  'pest',
  'general'
);

CREATE TYPE maintenance_urgency AS ENUM (
  'low',
  'medium',
  'high',
  'emergency'
);

CREATE TYPE maintenance_status AS ENUM (
  'submitted',
  'acknowledged',
  'scheduled',
  'in_progress',
  'completed',
  'closed'
);

CREATE TABLE maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid REFERENCES leases(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  category maintenance_category NOT NULL DEFAULT 'general',
  title text NOT NULL,
  description text,
  urgency maintenance_urgency NOT NULL DEFAULT 'medium',
  photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status maintenance_status NOT NULL DEFAULT 'submitted',
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  submitted_by_name text,
  submitted_by_phone text,
  submitted_by_email text,
  acknowledged_at timestamptz,
  scheduled_at timestamptz,
  completed_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_maintenance_requests_org_status
  ON maintenance_requests(organization_id, status, created_at DESC);
CREATE INDEX idx_maintenance_requests_lease
  ON maintenance_requests(lease_id);
CREATE INDEX idx_maintenance_requests_property
  ON maintenance_requests(property_id);

CREATE TRIGGER trg_maintenance_requests_updated_at
  BEFORE UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY maintenance_requests_org_member_all
  ON maintenance_requests FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));
