-- Casaora database schema
-- PostgreSQL 15+ compatible
-- Works on Supabase and Neon (RLS block is Supabase-oriented and optional on Neon).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- Enums ----------

CREATE TYPE member_role AS ENUM (
  'owner_admin',
  'operator',
  'cleaner',
  'accountant',
  'viewer'
);

CREATE TYPE organization_profile_type AS ENUM (
  'owner_operator',
  'management_company'
);

CREATE TYPE property_status AS ENUM (
  'active',
  'inactive'
);

CREATE TYPE channel_kind AS ENUM (
  'airbnb',
  'bookingcom',
  'direct',
  'vrbo',
  'other'
);

CREATE TYPE reservation_status AS ENUM (
  'pending',
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
  'no_show'
);

CREATE TYPE task_type AS ENUM (
  'cleaning',
  'maintenance',
  'check_in',
  'check_out',
  'inspection',
  'custom'
);

CREATE TYPE task_status AS ENUM (
  'todo',
  'in_progress',
  'done',
  'cancelled'
);

CREATE TYPE priority_level AS ENUM (
  'low',
  'medium',
  'high',
  'urgent'
);

CREATE TYPE expense_category AS ENUM (
  'cleaning',
  'maintenance',
  'utilities',
  'supplies',
  'platform_fee',
  'tax',
  'staff',
  'other'
);

CREATE TYPE payment_method AS ENUM (
  'bank_transfer',
  'cash',
  'card',
  'qr',
  'other'
);

CREATE TYPE statement_status AS ENUM (
  'draft',
  'finalized',
  'sent',
  'paid'
);

CREATE TYPE message_channel AS ENUM (
  'whatsapp',
  'email',
  'sms'
);

CREATE TYPE message_status AS ENUM (
  'queued',
  'sent',
  'delivered',
  'failed'
);

CREATE TYPE payment_instruction_status AS ENUM (
  'active',
  'expired',
  'cancelled',
  'paid'
);

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

CREATE TYPE fee_line_type AS ENUM (
  'monthly_rent',
  'advance_rent',
  'security_deposit',
  'service_fee_flat',
  'guarantee_option_fee',
  'admin_fee',
  'tax_iva',
  'other'
);

CREATE TYPE application_status AS ENUM (
  'new',
  'screening',
  'qualified',
  'visit_scheduled',
  'offer_sent',
  'contract_signed',
  'rejected',
  'lost'
);

CREATE TYPE lease_status AS ENUM (
  'draft',
  'active',
  'delinquent',
  'terminated',
  'completed'
);

CREATE TYPE collection_status AS ENUM (
  'scheduled',
  'pending',
  'paid',
  'late',
  'waived'
);

-- ---------- Utility functions ----------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Supabase-compatible helper.
-- On Neon/custom auth, replace this function to map to your session auth identity.
CREATE OR REPLACE FUNCTION auth_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- ---------- Identity and tenancy ----------

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone_e164 text,
  locale text NOT NULL DEFAULT 'es-PY',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  ruc text,
  profile_type organization_profile_type NOT NULL DEFAULT 'management_company',
  default_currency char(3) NOT NULL DEFAULT 'PYG' CHECK (default_currency IN ('PYG', 'USD')),
  timezone text NOT NULL DEFAULT 'America/Asuncion',
  country_code char(2) NOT NULL DEFAULT 'PY',
  owner_user_id uuid NOT NULL REFERENCES app_users(id),
  bank_name text,
  bank_account_number text,
  bank_account_holder text,
  qr_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_owner_user_id ON organizations(owner_user_id);

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'operator',
  is_primary boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX idx_org_members_user_id ON organization_members(user_id);

-- Email-based invites (onboarding without UUID sharing)
CREATE TABLE organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email citext NOT NULL,
  role member_role NOT NULL DEFAULT 'operator',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  accepted_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_org_invites_unique_pending_email
  ON organization_invites(organization_id, email)
  WHERE status = 'pending';

CREATE INDEX idx_org_invites_org_status_created
  ON organization_invites(organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = org_id
      AND om.user_id = auth_user_id()
  );
$$;

-- ---------- Properties and listings ----------

CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  status property_status NOT NULL DEFAULT 'active',
  address_line1 text,
  address_line2 text,
  city text NOT NULL DEFAULT 'Asuncion',
  region text,
  postal_code text,
  country_code char(2) NOT NULL DEFAULT 'PY',
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX idx_properties_org_id ON properties(organization_id);
CREATE INDEX idx_properties_status ON properties(organization_id, status);

CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  max_guests smallint NOT NULL DEFAULT 2 CHECK (max_guests > 0),
  bedrooms smallint NOT NULL DEFAULT 1 CHECK (bedrooms >= 0),
  bathrooms numeric(4, 1) NOT NULL DEFAULT 1.0 CHECK (bathrooms >= 0),
  square_meters numeric(8, 2),
  check_in_time time NOT NULL DEFAULT '15:00:00',
  check_out_time time NOT NULL DEFAULT '11:00:00',
  default_nightly_rate numeric(12, 2) NOT NULL DEFAULT 0 CHECK (default_nightly_rate >= 0),
  default_cleaning_fee numeric(12, 2) NOT NULL DEFAULT 0 CHECK (default_cleaning_fee >= 0),
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);

CREATE INDEX idx_units_org_id ON units(organization_id);
CREATE INDEX idx_units_property_id ON units(property_id);

CREATE TABLE integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  kind channel_kind NOT NULL,
  channel_name text NOT NULL,
  external_account_ref text,
  external_listing_id text,
  public_name text NOT NULL,
  marketplace_publishable boolean NOT NULL DEFAULT false,
  public_slug text,
  ical_import_url text,
  ical_export_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, kind, organization_id)
);

CREATE UNIQUE INDEX idx_integrations_kind_external
  ON integrations(kind, external_listing_id)
  WHERE external_listing_id IS NOT NULL;

CREATE INDEX idx_integrations_org_id ON integrations(organization_id);
CREATE INDEX idx_integrations_unit_id ON integrations(unit_id);
CREATE UNIQUE INDEX idx_integrations_org_public_slug
  ON integrations(organization_id, public_slug)
  WHERE public_slug IS NOT NULL;

-- ---------- Guests and reservations ----------

CREATE TABLE guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email citext,
  phone_e164 text,
  document_type text,
  document_number text,
  country_code char(2),
  preferred_language text NOT NULL DEFAULT 'es',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_guests_org_id ON guests(organization_id);
CREATE INDEX idx_guests_email ON guests(organization_id, email);

CREATE TABLE cancellation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  refund_percent numeric(5, 2) NOT NULL DEFAULT 100,
  cutoff_hours integer NOT NULL DEFAULT 48,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES integrations(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES guests(id) ON DELETE SET NULL,
  external_reservation_id text,
  status reservation_status NOT NULL DEFAULT 'pending',
  source text NOT NULL DEFAULT 'manual',
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  period daterange GENERATED ALWAYS AS (daterange(check_in_date, check_out_date, '[)')) STORED,
  adults smallint NOT NULL DEFAULT 1 CHECK (adults >= 0),
  children smallint NOT NULL DEFAULT 0 CHECK (children >= 0),
  infants smallint NOT NULL DEFAULT 0 CHECK (infants >= 0),
  pets smallint NOT NULL DEFAULT 0 CHECK (pets >= 0),
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  nightly_rate numeric(12, 2) NOT NULL DEFAULT 0 CHECK (nightly_rate >= 0),
  cleaning_fee numeric(12, 2) NOT NULL DEFAULT 0 CHECK (cleaning_fee >= 0),
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  extra_fees numeric(12, 2) NOT NULL DEFAULT 0 CHECK (extra_fees >= 0),
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_paid numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  platform_fee numeric(12, 2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  owner_payout_estimate numeric(12, 2) NOT NULL DEFAULT 0,
  payment_method payment_method,
  payment_reference text,
  cancellation_policy_id uuid REFERENCES cancellation_policies(id) ON DELETE SET NULL,
  deposit_amount numeric(12, 2) NOT NULL DEFAULT 0,
  deposit_status text NOT NULL DEFAULT 'none',
  deposit_refunded_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  notes text,
  created_by_user_id uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out_date > check_in_date)
);

CREATE INDEX idx_reservations_org_id ON reservations(organization_id);
CREATE INDEX idx_reservations_unit_dates ON reservations(unit_id, check_in_date, check_out_date);
CREATE INDEX idx_reservations_status_dates ON reservations(organization_id, status, check_in_date);
CREATE INDEX idx_reservations_guest_id ON reservations(guest_id);
CREATE INDEX idx_reservations_period_gist ON reservations USING gist (unit_id, period);

CREATE UNIQUE INDEX idx_reservations_integration_external
  ON reservations(integration_id, external_reservation_id)
  WHERE external_reservation_id IS NOT NULL AND integration_id IS NOT NULL;

ALTER TABLE reservations
  ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (unit_id WITH =, period WITH &&)
  WHERE (status IN ('pending', 'confirmed', 'checked_in'));

CREATE TABLE calendar_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  period daterange GENERATED ALWAYS AS (daterange(starts_on, ends_on, '[)')) STORED,
  reason text,
  recurrence_rule text,
  recurrence_end_date date,
  created_by_user_id uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on)
);

CREATE INDEX idx_calendar_blocks_org_id ON calendar_blocks(organization_id);
CREATE INDEX idx_calendar_blocks_unit_dates ON calendar_blocks(unit_id, starts_on, ends_on);
CREATE INDEX idx_calendar_blocks_period_gist ON calendar_blocks USING gist (unit_id, period);

ALTER TABLE calendar_blocks
  ADD CONSTRAINT calendar_blocks_no_overlap
  EXCLUDE USING gist (unit_id WITH =, period WITH &&);

-- ---------- Task operations ----------

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  type task_type NOT NULL DEFAULT 'custom',
  status task_status NOT NULL DEFAULT 'todo',
  priority priority_level NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text,
  due_at timestamptz,
  sla_due_at timestamptz,
  sla_breached_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completion_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_org_status_due ON tasks(organization_id, status, due_at);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_user_id, status);
CREATE INDEX idx_tasks_reservation ON tasks(reservation_id);

CREATE TABLE task_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 1,
  label text NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  is_completed boolean NOT NULL DEFAULT false,
  completed_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, sort_order)
);

CREATE INDEX idx_task_items_task_id ON task_items(task_id);

-- ---------- Finance ----------

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  category expense_category NOT NULL DEFAULT 'other',
  vendor_name text,
  expense_date date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  fx_rate_to_pyg numeric(14, 6),
  payment_method payment_method NOT NULL DEFAULT 'bank_transfer',
  invoice_number text,
  invoice_ruc text,
  receipt_url text,
  notes text,
  approval_status text NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  iva_applicable boolean NOT NULL DEFAULT false,
  iva_amount numeric(12, 2) NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expenses_org_date ON expenses(organization_id, expense_date);
CREATE INDEX idx_expenses_org_category ON expenses(organization_id, category);
CREATE INDEX idx_expenses_reservation_id ON expenses(reservation_id);

CREATE TABLE owner_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  gross_revenue numeric(12, 2) NOT NULL DEFAULT 0,
  lease_collections numeric(12, 2) NOT NULL DEFAULT 0,
  service_fees numeric(12, 2) NOT NULL DEFAULT 0,
  collection_fees numeric(12, 2) NOT NULL DEFAULT 0,
  platform_fees numeric(12, 2) NOT NULL DEFAULT 0,
  taxes_collected numeric(12, 2) NOT NULL DEFAULT 0,
  operating_expenses numeric(12, 2) NOT NULL DEFAULT 0,
  net_payout numeric(12, 2) NOT NULL DEFAULT 0,
  status statement_status NOT NULL DEFAULT 'draft',
  approval_status text NOT NULL DEFAULT 'none',
  approval_requested_at timestamptz,
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  pdf_url text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE INDEX idx_owner_statements_org_period
  ON owner_statements(organization_id, period_start, period_end);

CREATE TABLE pricing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX idx_pricing_templates_org_id
  ON pricing_templates(organization_id, is_active);

CREATE TABLE pricing_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pricing_template_id uuid NOT NULL REFERENCES pricing_templates(id) ON DELETE CASCADE,
  fee_type fee_line_type NOT NULL,
  label text NOT NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_refundable boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pricing_template_id, sort_order)
);

CREATE INDEX idx_pricing_template_lines_org_id
  ON pricing_template_lines(organization_id, pricing_template_id);

CREATE TABLE listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES integrations(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  pricing_template_id uuid REFERENCES pricing_templates(id) ON DELETE SET NULL,
  public_slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text,
  description text,
  neighborhood text,
  city text NOT NULL DEFAULT 'Asuncion',
  country_code char(2) NOT NULL DEFAULT 'PY',
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  application_url text,
  cover_image_url text,
  gallery_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  bedrooms smallint CHECK (bedrooms >= 0),
  bathrooms numeric(4, 1) CHECK (bathrooms >= 0),
  square_meters numeric(8, 2) CHECK (square_meters >= 0),
  property_type text,
  furnished boolean NOT NULL DEFAULT false,
  pet_policy text,
  parking_spaces smallint CHECK (parking_spaces >= 0),
  minimum_lease_months smallint CHECK (minimum_lease_months >= 1),
  available_from date,
  amenities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(amenities) = 'array'),
  maintenance_fee numeric(12, 2) NOT NULL DEFAULT 0 CHECK (maintenance_fee >= 0),
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_listings_org_published
  ON listings(organization_id, is_published, created_at DESC);
CREATE INDEX idx_listings_org_slug
  ON listings(organization_id, public_slug);

CREATE TABLE listing_fee_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  fee_type fee_line_type NOT NULL,
  label text NOT NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_refundable boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, sort_order)
);

CREATE INDEX idx_listing_fee_lines_org
  ON listing_fee_lines(organization_id, listing_id);

CREATE TABLE application_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
  status application_status NOT NULL DEFAULT 'new',
  full_name text NOT NULL,
  email citext NOT NULL,
  phone_e164 text,
  document_number text,
  monthly_income numeric(12, 2),
  guarantee_choice text NOT NULL DEFAULT 'cash_deposit',
  message text,
  source text NOT NULL DEFAULT 'marketplace',
  assigned_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  first_response_at timestamptz,
  qualified_at timestamptz,
  rejected_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_application_submissions_org_status
  ON application_submissions(organization_id, status, created_at DESC);
CREATE INDEX idx_application_submissions_listing
  ON application_submissions(listing_id);

CREATE TABLE application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES application_submissions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_application_events_org_created
  ON application_events(organization_id, created_at DESC);
CREATE INDEX idx_application_events_application
  ON application_events(application_id, created_at DESC);

CREATE TABLE leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid REFERENCES application_submissions(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,
  tenant_full_name text NOT NULL,
  tenant_email citext,
  tenant_phone_e164 text,
  lease_status lease_status NOT NULL DEFAULT 'draft',
  starts_on date NOT NULL,
  ends_on date,
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  monthly_rent numeric(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_rent >= 0),
  service_fee_flat numeric(12, 2) NOT NULL DEFAULT 0 CHECK (service_fee_flat >= 0),
  security_deposit numeric(12, 2) NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
  guarantee_option_fee numeric(12, 2) NOT NULL DEFAULT 0 CHECK (guarantee_option_fee >= 0),
  tax_iva numeric(12, 2) NOT NULL DEFAULT 0 CHECK (tax_iva >= 0),
  total_move_in numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_move_in >= 0),
  monthly_recurring_total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_recurring_total >= 0),
  platform_fee numeric(12, 2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  notes text,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leases_org_status
  ON leases(organization_id, lease_status, created_at DESC);
CREATE INDEX idx_leases_unit
  ON leases(unit_id, starts_on);

CREATE TABLE lease_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  charge_date date NOT NULL,
  charge_type fee_line_type NOT NULL,
  description text,
  amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  status collection_status NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lease_charges_org_date
  ON lease_charges(organization_id, charge_date, status);
CREATE INDEX idx_lease_charges_lease
  ON lease_charges(lease_id);

CREATE TABLE collection_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  lease_charge_id uuid REFERENCES lease_charges(id) ON DELETE SET NULL,
  due_date date NOT NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'PYG' CHECK (currency IN ('PYG', 'USD')),
  status collection_status NOT NULL DEFAULT 'scheduled',
  payment_method payment_method,
  payment_reference text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  notes text,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_collection_records_org_status_due
  ON collection_records(organization_id, status, due_date);
CREATE INDEX idx_collection_records_lease
  ON collection_records(lease_id, due_date);

-- ---------- Messaging ----------

CREATE TABLE message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  name text NOT NULL,
  channel message_channel NOT NULL DEFAULT 'whatsapp',
  language_code text NOT NULL DEFAULT 'es-PY',
  subject text,
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, template_key, language_code)
);

CREATE INDEX idx_message_templates_org_channel
  ON message_templates(organization_id, channel, is_active);

CREATE TABLE message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES guests(id) ON DELETE SET NULL,
  template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  channel message_channel NOT NULL DEFAULT 'whatsapp',
  recipient text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status message_status NOT NULL DEFAULT 'queued',
  scheduled_at timestamptz,
  sent_at timestamptz,
  error_message text,
  provider_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_logs_org_status ON message_logs(organization_id, status, created_at);
CREATE INDEX idx_message_logs_recipient ON message_logs(recipient);

-- ---------- AI agents and chats ----------

CREATE TABLE ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  icon_key text NOT NULL DEFAULT 'SparklesIcon',
  system_prompt text NOT NULL,
  allowed_tools jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allowed_tools) = 'array'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_agents_active_slug
  ON ai_agents(is_active, slug);

CREATE TABLE ai_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE RESTRICT,
  title text NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_chats_org_user_archived_last
  ON ai_chats(organization_id, created_by_user_id, is_archived, last_message_at DESC);

CREATE INDEX idx_ai_chats_agent_id
  ON ai_chats(agent_id);

CREATE TABLE ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  tool_trace jsonb,
  model_used text,
  fallback_used boolean NOT NULL DEFAULT false,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_chat_messages_chat_created
  ON ai_chat_messages(chat_id, created_at DESC);

CREATE INDEX idx_ai_chat_messages_org_user_created
  ON ai_chat_messages(organization_id, created_by_user_id, created_at DESC);

-- ---------- Tenant access tokens ----------

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

CREATE INDEX idx_tenant_access_tokens_lease ON tenant_access_tokens(lease_id);
CREATE INDEX idx_tenant_access_tokens_email ON tenant_access_tokens(email);
CREATE INDEX idx_tenant_access_tokens_hash ON tenant_access_tokens(token_hash);

-- ---------- Maintenance requests ----------

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
CREATE INDEX idx_maintenance_requests_lease ON maintenance_requests(lease_id);
CREATE INDEX idx_maintenance_requests_property ON maintenance_requests(property_id);

-- ---------- Payment instructions ----------

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

-- ---------- Notification rules ----------

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

-- ---------- Documents ----------

CREATE TYPE document_category AS ENUM (
  'lease_contract', 'id_document', 'invoice', 'receipt',
  'photo', 'inspection_report', 'other'
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

-- ---------- Workflow rules ----------

CREATE TYPE workflow_trigger_event AS ENUM (
  'reservation_confirmed', 'checked_in', 'checked_out',
  'lease_created', 'lease_activated', 'collection_overdue',
  'application_received', 'maintenance_submitted'
);

CREATE TYPE workflow_action_type AS ENUM (
  'create_task', 'send_notification', 'update_status', 'create_expense'
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

-- ---------- SaaS subscriptions ----------

CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

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

CREATE INDEX idx_org_subscriptions_status ON org_subscriptions(status);
CREATE INDEX idx_org_subscriptions_stripe
  ON org_subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_org_subscriptions_updated_at
  BEFORE UPDATE ON org_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE platform_admins (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Integrations and audit ----------

CREATE TABLE integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  event_type text NOT NULL,
  external_event_id text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_integration_events_provider_external
  ON integration_events(provider, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE INDEX idx_integration_events_status ON integration_events(status, received_at);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_name text NOT NULL,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_org_created_at ON audit_logs(organization_id, created_at DESC);

CREATE TABLE contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'es',
  body_template text NOT NULL DEFAULT '',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_templates_org ON contract_templates(organization_id);

CREATE TABLE owner_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_owner_access_tokens_hash ON owner_access_tokens(token_hash);

-- ---------- Update triggers ----------

CREATE TRIGGER trg_app_users_updated_at
  BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_organization_members_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_organization_invites_updated_at
  BEFORE UPDATE ON organization_invites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_units_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_integrations_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_guests_updated_at
  BEFORE UPDATE ON guests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_calendar_blocks_updated_at
  BEFORE UPDATE ON calendar_blocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_task_items_updated_at
  BEFORE UPDATE ON task_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_owner_statements_updated_at
  BEFORE UPDATE ON owner_statements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pricing_templates_updated_at
  BEFORE UPDATE ON pricing_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pricing_template_lines_updated_at
  BEFORE UPDATE ON pricing_template_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_listings_updated_at
  BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_listing_fee_lines_updated_at
  BEFORE UPDATE ON listing_fee_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_application_submissions_updated_at
  BEFORE UPDATE ON application_submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_leases_updated_at
  BEFORE UPDATE ON leases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_lease_charges_updated_at
  BEFORE UPDATE ON lease_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_collection_records_updated_at
  BEFORE UPDATE ON collection_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_message_logs_updated_at
  BEFORE UPDATE ON message_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenant_access_tokens_updated_at
  BEFORE UPDATE ON tenant_access_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_maintenance_requests_updated_at
  BEFORE UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payment_instructions_updated_at
  BEFORE UPDATE ON payment_instructions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notification_rules_updated_at
  BEFORE UPDATE ON notification_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_ai_agents_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_ai_chats_updated_at
  BEFORE UPDATE ON ai_chats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_integration_events_updated_at
  BEFORE UPDATE ON integration_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Optional RLS policies (Supabase-friendly) ----------
-- If you are on Neon and enforcing tenancy in application code, keep RLS disabled
-- or adapt auth_user_id() to your session variable model.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_member_read
  ON organizations FOR SELECT
  USING (is_org_member(id));
CREATE POLICY organizations_owner_update
  ON organizations FOR UPDATE
  USING (owner_user_id = auth_user_id())
  WITH CHECK (owner_user_id = auth_user_id());

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_members_member_read
  ON organization_members FOR SELECT
  USING (is_org_member(organization_id));
CREATE POLICY organization_members_owner_write
  ON organization_members FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = auth_user_id()
        AND om.role = 'owner_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = auth_user_id()
        AND om.role = 'owner_admin'
    )
  );

ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_invites_owner_admin_all
  ON organization_invites FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.organization_id = organization_invites.organization_id
        AND om.user_id = auth_user_id()
        AND om.role = 'owner_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.organization_id = organization_invites.organization_id
        AND om.user_id = auth_user_id()
        AND om.role = 'owner_admin'
    )
  );

-- Uniform member policies for organization-scoped tables.
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_template_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_fee_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY properties_org_member_all
  ON properties FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY units_org_member_all
  ON units FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY integrations_org_member_all
  ON integrations FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY guests_org_member_all
  ON guests FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY reservations_org_member_all
  ON reservations FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY calendar_blocks_org_member_all
  ON calendar_blocks FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY tasks_org_member_all
  ON tasks FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY expenses_org_member_all
  ON expenses FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY owner_statements_org_member_all
  ON owner_statements FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY pricing_templates_org_member_all
  ON pricing_templates FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY pricing_template_lines_org_member_all
  ON pricing_template_lines FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY listings_org_member_all
  ON listings FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY listing_fee_lines_org_member_all
  ON listing_fee_lines FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY application_submissions_org_member_all
  ON application_submissions FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY application_events_org_member_all
  ON application_events FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY leases_org_member_all
  ON leases FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY lease_charges_org_member_all
  ON lease_charges FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY collection_records_org_member_all
  ON collection_records FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY message_templates_org_member_all
  ON message_templates FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY message_logs_org_member_all
  ON message_logs FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY maintenance_requests_org_member_all
  ON maintenance_requests FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY payment_instructions_org_member_all
  ON payment_instructions FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY notification_rules_org_member_all
  ON notification_rules FOR ALL
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY ai_agents_read_authenticated
  ON ai_agents FOR SELECT
  USING (auth_user_id() IS NOT NULL);

CREATE POLICY ai_chats_owner_all
  ON ai_chats FOR ALL
  USING (is_org_member(organization_id) AND created_by_user_id = auth_user_id())
  WITH CHECK (is_org_member(organization_id) AND created_by_user_id = auth_user_id());

CREATE POLICY ai_chat_messages_owner_all
  ON ai_chat_messages FOR ALL
  USING (is_org_member(organization_id) AND created_by_user_id = auth_user_id())
  WITH CHECK (is_org_member(organization_id) AND created_by_user_id = auth_user_id());
