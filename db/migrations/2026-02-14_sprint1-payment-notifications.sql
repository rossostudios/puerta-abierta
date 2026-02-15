-- Sprint 1: Payment Foundation + Notification Delivery
-- Tables: payment_instructions, notification_rules

-- ---------- Payment Instructions ----------

CREATE TYPE payment_instruction_status AS ENUM (
  'active',
  'expired',
  'cancelled',
  'paid'
);

CREATE TABLE payment_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  collection_record_id uuid NOT NULL REFERENCES collection_records(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  reference_code text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  payment_method payment_method NOT NULL DEFAULT 'bank_transfer',
  bank_name text,
  account_number text,
  account_holder text,
  qr_payload_url text,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  status payment_instruction_status NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  tenant_name text,
  tenant_phone_e164 text,
  notes text,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_instructions_org
  ON payment_instructions(organization_id, status, created_at DESC);
CREATE INDEX idx_payment_instructions_collection
  ON payment_instructions(collection_record_id);
CREATE INDEX idx_payment_instructions_reference
  ON payment_instructions(reference_code);

CREATE TRIGGER trg_payment_instructions_updated_at
  BEFORE UPDATE ON payment_instructions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE payment_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_instructions_org_member_all
  ON payment_instructions FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

-- ---------- Organization Payment Settings ----------

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_holder text,
  ADD COLUMN IF NOT EXISTS qr_image_url text;

-- ---------- Notification Rules ----------

CREATE TYPE notification_trigger_event AS ENUM (
  'rent_due_3d',
  'rent_due_1d',
  'rent_overdue_1d',
  'rent_overdue_7d',
  'application_received',
  'task_assigned',
  'lease_expiring_30d',
  'maintenance_submitted',
  'payment_confirmed'
);

CREATE TABLE notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trigger_event notification_trigger_event NOT NULL,
  message_template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  channel message_channel NOT NULL DEFAULT 'whatsapp',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, trigger_event, channel)
);

CREATE INDEX idx_notification_rules_org_active
  ON notification_rules(organization_id, is_active);

CREATE TRIGGER trg_notification_rules_updated_at
  BEFORE UPDATE ON notification_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_rules_org_member_all
  ON notification_rules FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

-- ---------- Add delivered status to message_status ----------

ALTER TYPE message_status ADD VALUE IF NOT EXISTS 'delivered';
