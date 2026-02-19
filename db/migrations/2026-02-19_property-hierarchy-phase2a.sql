-- Phase 2A: Canonical spatial hierarchy for property operations.
-- Additive and backward-compatible.

CREATE TABLE IF NOT EXISTS property_floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label text NOT NULL,
  number smallint,
  sort_order integer NOT NULL DEFAULT 0,
  has_elevator_access boolean,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, label),
  UNIQUE (property_id, number)
);

CREATE TABLE IF NOT EXISTS unit_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  floor_id uuid REFERENCES property_floors(id) ON DELETE SET NULL,
  space_type text NOT NULL DEFAULT 'room'
    CHECK (space_type IN ('room', 'shared_zone', 'alcove', 'bathroom', 'kitchen', 'other')),
  name text NOT NULL,
  code text,
  max_occupancy smallint NOT NULL DEFAULT 1 CHECK (max_occupancy > 0),
  status text NOT NULL DEFAULT 'available'
    CHECK (
      status IN (
        'available',
        'occupied',
        'reserved',
        'dirty',
        'inspecting',
        'out_of_order',
        'blocked'
      )
    ),
  area_sqm numeric(8, 2) CHECK (area_sqm IS NULL OR area_sqm >= 0),
  amenities jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(amenities) = 'array'),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, name),
  UNIQUE (unit_id, code)
);

CREATE TABLE IF NOT EXISTS unit_beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  space_id uuid REFERENCES unit_spaces(id) ON DELETE SET NULL,
  code text NOT NULL,
  bed_type text NOT NULL DEFAULT 'single'
    CHECK (bed_type IN ('single', 'twin', 'double', 'queen', 'king', 'bunk', 'sofa_bed', 'other')),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'reserved', 'dirty', 'inspecting', 'out_of_order', 'blocked')),
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, code)
);

CREATE TABLE IF NOT EXISTS unit_condition_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  space_id uuid REFERENCES unit_spaces(id) ON DELETE SET NULL,
  bed_id uuid REFERENCES unit_beds(id) ON DELETE SET NULL,
  previous_status text,
  next_status text NOT NULL,
  source text NOT NULL DEFAULT 'system'
    CHECK (source IN ('system', 'manual', 'workflow', 'integration', 'api')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_floors_org_property_sort
  ON property_floors (organization_id, property_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_property_floors_property_id
  ON property_floors (property_id);

CREATE INDEX IF NOT EXISTS idx_unit_spaces_org_unit_status
  ON unit_spaces (organization_id, unit_id, status);
CREATE INDEX IF NOT EXISTS idx_unit_spaces_org_floor_status
  ON unit_spaces (organization_id, floor_id, status);
CREATE INDEX IF NOT EXISTS idx_unit_spaces_property_id
  ON unit_spaces (property_id);
CREATE INDEX IF NOT EXISTS idx_unit_spaces_floor_id
  ON unit_spaces (floor_id);

CREATE INDEX IF NOT EXISTS idx_unit_beds_org_unit_status
  ON unit_beds (organization_id, unit_id, status);
CREATE INDEX IF NOT EXISTS idx_unit_beds_property_id
  ON unit_beds (property_id);
CREATE INDEX IF NOT EXISTS idx_unit_beds_space_id
  ON unit_beds (space_id);

CREATE INDEX IF NOT EXISTS idx_unit_condition_events_org_unit_created
  ON unit_condition_events (organization_id, unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_condition_events_org_property_created
  ON unit_condition_events (organization_id, property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_condition_events_space_id
  ON unit_condition_events (space_id);
CREATE INDEX IF NOT EXISTS idx_unit_condition_events_bed_id
  ON unit_condition_events (bed_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_property_floors_updated_at'
      AND tgrelid = 'property_floors'::regclass
  ) THEN
    CREATE TRIGGER trg_property_floors_updated_at
      BEFORE UPDATE ON property_floors
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_unit_spaces_updated_at'
      AND tgrelid = 'unit_spaces'::regclass
  ) THEN
    CREATE TRIGGER trg_unit_spaces_updated_at
      BEFORE UPDATE ON unit_spaces
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_unit_beds_updated_at'
      AND tgrelid = 'unit_beds'::regclass
  ) THEN
    CREATE TRIGGER trg_unit_beds_updated_at
      BEFORE UPDATE ON unit_beds
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

ALTER TABLE property_floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_condition_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'property_floors'
      AND policyname = 'property_floors_org_member_all'
  ) THEN
    CREATE POLICY property_floors_org_member_all
      ON property_floors FOR ALL
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
      AND tablename = 'unit_spaces'
      AND policyname = 'unit_spaces_org_member_all'
  ) THEN
    CREATE POLICY unit_spaces_org_member_all
      ON unit_spaces FOR ALL
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
      AND tablename = 'unit_beds'
      AND policyname = 'unit_beds_org_member_all'
  ) THEN
    CREATE POLICY unit_beds_org_member_all
      ON unit_beds FOR ALL
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
      AND tablename = 'unit_condition_events'
      AND policyname = 'unit_condition_events_org_member_all'
  ) THEN
    CREATE POLICY unit_condition_events_org_member_all
      ON unit_condition_events FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END
$$;
