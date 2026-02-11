-- Migration: Q2 2026 marketplace + transparent leasing ops
-- Date: 2026-02-11
-- Safe to run multiple times.

-- ---------- Enums ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fee_line_type') THEN
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
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_status') THEN
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
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lease_status') THEN
    CREATE TYPE lease_status AS ENUM (
      'draft',
      'active',
      'delinquent',
      'terminated',
      'completed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collection_status') THEN
    CREATE TYPE collection_status AS ENUM (
      'scheduled',
      'pending',
      'paid',
      'late',
      'waived'
    );
  END IF;
END $$;

-- ---------- Existing table extensions ----------
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS marketplace_publishable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_slug text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_org_public_slug
  ON listings(organization_id, public_slug)
  WHERE public_slug IS NOT NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz;

ALTER TABLE owner_statements
  ADD COLUMN IF NOT EXISTS lease_collections numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_fees numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collection_fees numeric(12, 2) NOT NULL DEFAULT 0;

-- ---------- New tables ----------
CREATE TABLE IF NOT EXISTS pricing_templates (
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

CREATE INDEX IF NOT EXISTS idx_pricing_templates_org_id
  ON pricing_templates(organization_id, is_active);

CREATE TABLE IF NOT EXISTS pricing_template_lines (
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

CREATE INDEX IF NOT EXISTS idx_pricing_template_lines_org_id
  ON pricing_template_lines(organization_id, pricing_template_id);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
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
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_org_published
  ON marketplace_listings(organization_id, is_published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_org_slug
  ON marketplace_listings(organization_id, public_slug);

CREATE TABLE IF NOT EXISTS marketplace_listing_fee_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  marketplace_listing_id uuid NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  fee_type fee_line_type NOT NULL,
  label text NOT NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_refundable boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (marketplace_listing_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_listing_fee_lines_org
  ON marketplace_listing_fee_lines(organization_id, marketplace_listing_id);

CREATE TABLE IF NOT EXISTS application_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  marketplace_listing_id uuid REFERENCES marketplace_listings(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_application_submissions_org_status
  ON application_submissions(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_application_submissions_listing
  ON application_submissions(marketplace_listing_id);

CREATE TABLE IF NOT EXISTS application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES application_submissions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_events_org_created
  ON application_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_application_events_application
  ON application_events(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS leases (
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

CREATE INDEX IF NOT EXISTS idx_leases_org_status
  ON leases(organization_id, lease_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leases_unit
  ON leases(unit_id, starts_on);

CREATE TABLE IF NOT EXISTS lease_charges (
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

CREATE INDEX IF NOT EXISTS idx_lease_charges_org_date
  ON lease_charges(organization_id, charge_date, status);
CREATE INDEX IF NOT EXISTS idx_lease_charges_lease
  ON lease_charges(lease_id);

CREATE TABLE IF NOT EXISTS collection_records (
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

CREATE INDEX IF NOT EXISTS idx_collection_records_org_status_due
  ON collection_records(organization_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_collection_records_lease
  ON collection_records(lease_id, due_date);

-- ---------- Update triggers ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pricing_templates_updated_at') THEN
    CREATE TRIGGER trg_pricing_templates_updated_at
      BEFORE UPDATE ON pricing_templates
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pricing_template_lines_updated_at') THEN
    CREATE TRIGGER trg_pricing_template_lines_updated_at
      BEFORE UPDATE ON pricing_template_lines
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_marketplace_listings_updated_at') THEN
    CREATE TRIGGER trg_marketplace_listings_updated_at
      BEFORE UPDATE ON marketplace_listings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_marketplace_listing_fee_lines_updated_at') THEN
    CREATE TRIGGER trg_marketplace_listing_fee_lines_updated_at
      BEFORE UPDATE ON marketplace_listing_fee_lines
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_application_submissions_updated_at') THEN
    CREATE TRIGGER trg_application_submissions_updated_at
      BEFORE UPDATE ON application_submissions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_leases_updated_at') THEN
    CREATE TRIGGER trg_leases_updated_at
      BEFORE UPDATE ON leases
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lease_charges_updated_at') THEN
    CREATE TRIGGER trg_lease_charges_updated_at
      BEFORE UPDATE ON lease_charges
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_collection_records_updated_at') THEN
    CREATE TRIGGER trg_collection_records_updated_at
      BEFORE UPDATE ON collection_records
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------- RLS ----------
ALTER TABLE pricing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_template_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_listing_fee_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pricing_templates' AND policyname = 'pricing_templates_org_member_all'
  ) THEN
    CREATE POLICY pricing_templates_org_member_all
      ON pricing_templates FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pricing_template_lines' AND policyname = 'pricing_template_lines_org_member_all'
  ) THEN
    CREATE POLICY pricing_template_lines_org_member_all
      ON pricing_template_lines FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'marketplace_listings' AND policyname = 'marketplace_listings_org_member_all'
  ) THEN
    CREATE POLICY marketplace_listings_org_member_all
      ON marketplace_listings FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'marketplace_listing_fee_lines' AND policyname = 'marketplace_listing_fee_lines_org_member_all'
  ) THEN
    CREATE POLICY marketplace_listing_fee_lines_org_member_all
      ON marketplace_listing_fee_lines FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'application_submissions' AND policyname = 'application_submissions_org_member_all'
  ) THEN
    CREATE POLICY application_submissions_org_member_all
      ON application_submissions FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'application_events' AND policyname = 'application_events_org_member_all'
  ) THEN
    CREATE POLICY application_events_org_member_all
      ON application_events FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leases' AND policyname = 'leases_org_member_all'
  ) THEN
    CREATE POLICY leases_org_member_all
      ON leases FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lease_charges' AND policyname = 'lease_charges_org_member_all'
  ) THEN
    CREATE POLICY lease_charges_org_member_all
      ON lease_charges FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'collection_records' AND policyname = 'collection_records_org_member_all'
  ) THEN
    CREATE POLICY collection_records_org_member_all
      ON collection_records FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END $$;
