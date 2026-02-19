-- Phase 3 (leases): fractional occupancy targets + turnover buffers + rent-roll query indexes.
-- Additive and backward-compatible.

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES unit_spaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bed_id uuid REFERENCES unit_beds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS turnover_buffer_hours smallint NOT NULL DEFAULT 24;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leases_turnover_buffer_hours_range'
      AND conrelid = 'leases'::regclass
  ) THEN
    ALTER TABLE leases
      ADD CONSTRAINT leases_turnover_buffer_hours_range
      CHECK (turnover_buffer_hours >= 0 AND turnover_buffer_hours <= 240);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_leases_space
  ON leases(space_id, starts_on)
  WHERE space_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leases_bed
  ON leases(bed_id, starts_on)
  WHERE bed_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leases_org_property_starts
  ON leases(organization_id, property_id, starts_on);

CREATE INDEX IF NOT EXISTS idx_leases_unit_active_window
  ON leases(unit_id, starts_on, ends_on)
  WHERE lease_status IN ('draft', 'active', 'delinquent');
