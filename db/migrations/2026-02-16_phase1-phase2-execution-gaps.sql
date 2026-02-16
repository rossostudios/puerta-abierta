-- Phase 1 + Phase 2: Close execution gaps
-- Workflow engine, messaging, payments, iCal sync, sequences, guest verification, direct booking

-- ============================================================
-- 1. Extend workflow enums
-- ============================================================

ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'task_completed';
ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'payment_received';
ALTER TYPE workflow_trigger_event ADD VALUE IF NOT EXISTS 'lease_expiring';

ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'send_whatsapp';
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'assign_task_round_robin';

-- ============================================================
-- 2. Message logs: direction + retry
-- ============================================================

ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outbound'
  CHECK (direction IN ('inbound', 'outbound'));
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_message_logs_direction
  ON message_logs (direction, created_at DESC);

-- ============================================================
-- 3. Integrations: iCal sync tracking
-- ============================================================

ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_ical_sync_at timestamptz;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS ical_sync_error text;

-- ============================================================
-- 4. Payments: Stripe + receipt
-- ============================================================

ALTER TABLE payment_instructions ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;
ALTER TABLE collection_records ADD COLUMN IF NOT EXISTS receipt_url text;

-- ============================================================
-- 5. Guest verification
-- ============================================================

ALTER TABLE guests ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected'));
ALTER TABLE guests ADD COLUMN IF NOT EXISTS id_document_url text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS selfie_url text;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- ============================================================
-- 6. Direct booking: org branding
-- ============================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS org_slug text UNIQUE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS booking_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_color text DEFAULT '#2563eb';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url text;

CREATE INDEX IF NOT EXISTS idx_organizations_slug
  ON organizations (org_slug) WHERE org_slug IS NOT NULL;

-- ============================================================
-- 7. Communication sequences
-- ============================================================

CREATE TABLE IF NOT EXISTS communication_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'reservation_confirmed', 'checked_in', 'checked_out',
    'lease_activated', 'lease_expiring', 'manual'
  )),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES communication_sequences(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  delay_hours integer NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email', 'sms')),
  subject text,
  body_template text NOT NULL,
  template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_order)
);

CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES communication_sequences(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('reservation', 'lease')),
  entity_id uuid NOT NULL,
  current_step integer NOT NULL DEFAULT 1,
  next_send_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  recipient text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_next_send
  ON sequence_enrollments (next_send_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_entity
  ON sequence_enrollments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sequence_steps_sequence
  ON sequence_steps (sequence_id, step_order);
CREATE INDEX IF NOT EXISTS idx_communication_sequences_org
  ON communication_sequences (organization_id, is_active);

-- Triggers
CREATE TRIGGER set_communication_sequences_updated_at
  BEFORE UPDATE ON communication_sequences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_sequence_enrollments_updated_at
  BEFORE UPDATE ON sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE communication_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_all" ON communication_sequences FOR ALL
  USING (is_org_member(organization_id));
CREATE POLICY "org_member_all" ON sequence_steps FOR ALL
  USING (EXISTS (
    SELECT 1 FROM communication_sequences cs
    WHERE cs.id = sequence_id AND is_org_member(cs.organization_id)
  ));
CREATE POLICY "org_member_all" ON sequence_enrollments FOR ALL
  USING (is_org_member(organization_id));
