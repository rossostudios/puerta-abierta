-- Sprint 3-5: Documents, Workflows, SaaS Platform

-- ---------- Sprint 3: Documents ----------

CREATE TYPE document_category AS ENUM (
  'lease_contract',
  'id_document',
  'invoice',
  'receipt',
  'photo',
  'inspection_report',
  'other'
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size_bytes bigint,
  mime_type text,
  category document_category NOT NULL DEFAULT 'other',
  uploaded_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_org ON documents(organization_id, entity_type, entity_id);
CREATE INDEX idx_documents_entity ON documents(entity_type, entity_id);

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_org_member_all
  ON documents FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

-- ---------- Sprint 4: Workflow Rules ----------

CREATE TYPE workflow_trigger_event AS ENUM (
  'reservation_confirmed',
  'checked_in',
  'checked_out',
  'lease_created',
  'lease_activated',
  'collection_overdue',
  'application_received',
  'maintenance_submitted'
);

CREATE TYPE workflow_action_type AS ENUM (
  'create_task',
  'send_notification',
  'update_status',
  'create_expense'
);

CREATE TABLE workflow_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_event workflow_trigger_event NOT NULL,
  action_type workflow_action_type NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  delay_minutes integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_rules_org_active
  ON workflow_rules(organization_id, is_active, trigger_event);

CREATE TRIGGER trg_workflow_rules_updated_at
  BEFORE UPDATE ON workflow_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE workflow_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_rules_org_member_all
  ON workflow_rules FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

-- ---------- Sprint 5: SaaS Subscriptions ----------

CREATE TYPE subscription_status AS ENUM (
  'trialing',
  'active',
  'past_due',
  'cancelled'
);

CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  stripe_price_id text,
  max_properties integer NOT NULL DEFAULT 3,
  max_units integer NOT NULL DEFAULT 10,
  max_users integer NOT NULL DEFAULT 2,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_usd numeric(8, 2) NOT NULL DEFAULT 0,
  price_pyg numeric(12, 0) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  stripe_subscription_id text,
  stripe_customer_id text,
  status subscription_status NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

CREATE INDEX idx_org_subscriptions_status
  ON org_subscriptions(status);
CREATE INDEX idx_org_subscriptions_stripe
  ON org_subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_org_subscriptions_updated_at
  BEFORE UPDATE ON org_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Platform admins
CREATE TABLE platform_admins (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default plans
INSERT INTO subscription_plans (name, max_properties, max_units, max_users, price_usd, price_pyg, sort_order)
VALUES
  ('Free', 3, 10, 2, 0, 0, 1),
  ('Starter', 15, 50, 5, 29, 217500, 2),
  ('Pro', 50, 200, 15, 79, 592500, 3),
  ('Enterprise', 999, 9999, 999, 0, 0, 4);
