-- Property + Unit model expansion for multi-property and co-living operations.
-- Additive and backward-compatible.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS property_type text,
  ADD COLUMN IF NOT EXISTS building_amenities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS access_instructions text,
  ADD COLUMN IF NOT EXISTS shared_wifi_name text,
  ADD COLUMN IF NOT EXISTS shared_wifi_password text,
  ADD COLUMN IF NOT EXISTS asset_owner_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_owner_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'properties_building_amenities_array'
      AND conrelid = 'properties'::regclass
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_building_amenities_array
      CHECK (jsonb_typeof(building_amenities) = 'array');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'properties_property_type_allowed'
      AND conrelid = 'properties'::regclass
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_property_type_allowed
      CHECK (
        property_type IS NULL OR property_type IN (
          'apartment_building',
          'co_living_house',
          'hotel',
          'single_family',
          'multi_family',
          'hostel',
          'mixed_use'
        )
      );
  END IF;
END
$$;

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'entire_place',
  ADD COLUMN IF NOT EXISTS condition_status text NOT NULL DEFAULT 'clean',
  ADD COLUMN IF NOT EXISTS floor_level smallint,
  ADD COLUMN IF NOT EXISTS area_sqm numeric(8, 2),
  ADD COLUMN IF NOT EXISTS unit_amenities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS beds_count smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bed_configuration jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS base_price_nightly numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_price_monthly numeric(12, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_area_sqm_non_negative'
      AND conrelid = 'units'::regclass
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_area_sqm_non_negative
      CHECK (area_sqm IS NULL OR area_sqm >= 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_unit_amenities_array'
      AND conrelid = 'units'::regclass
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_unit_amenities_array
      CHECK (jsonb_typeof(unit_amenities) = 'array');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_bed_configuration_array'
      AND conrelid = 'units'::regclass
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_bed_configuration_array
      CHECK (jsonb_typeof(bed_configuration) = 'array');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_beds_count_positive'
      AND conrelid = 'units'::regclass
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_beds_count_positive
      CHECK (beds_count > 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_base_price_nightly_non_negative'
      AND conrelid = 'units'::regclass
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_base_price_nightly_non_negative
      CHECK (base_price_nightly >= 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_base_price_monthly_non_negative'
      AND conrelid = 'units'::regclass
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_base_price_monthly_non_negative
      CHECK (base_price_monthly >= 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_unit_type_allowed'
      AND conrelid = 'units'::regclass
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_unit_type_allowed
      CHECK (
        unit_type IN ('entire_place', 'private_room', 'shared_room', 'bed')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'units_condition_status_allowed'
      AND conrelid = 'units'::regclass
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_condition_status_allowed
      CHECK (
        condition_status IN ('clean', 'dirty', 'inspecting', 'out_of_order')
      );
  END IF;
END
$$;

-- Backfill aliases for compatibility between old and new fields.
UPDATE units
SET area_sqm = square_meters
WHERE area_sqm IS NULL
  AND square_meters IS NOT NULL;

UPDATE units
SET square_meters = area_sqm
WHERE square_meters IS NULL
  AND area_sqm IS NOT NULL;

UPDATE units
SET base_price_nightly = default_nightly_rate
WHERE base_price_nightly = 0
  AND default_nightly_rate > 0;

UPDATE units
SET default_nightly_rate = base_price_nightly
WHERE default_nightly_rate = 0
  AND base_price_nightly > 0;

CREATE INDEX IF NOT EXISTS idx_properties_org_property_type
  ON properties (organization_id, property_type);

CREATE INDEX IF NOT EXISTS idx_properties_owner_org
  ON properties (asset_owner_organization_id);

CREATE INDEX IF NOT EXISTS idx_units_org_unit_type
  ON units (organization_id, unit_type);

CREATE INDEX IF NOT EXISTS idx_units_org_condition_status
  ON units (organization_id, condition_status);
