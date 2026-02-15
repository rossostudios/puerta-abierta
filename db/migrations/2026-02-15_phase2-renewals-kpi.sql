-- Phase 2: Lease renewals, KPI support, maintenance notifications
-- ================================================================

-- 1. Lease renewal tracking fields
ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS parent_lease_id uuid REFERENCES leases(id),
  ADD COLUMN IF NOT EXISTS is_renewal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renewal_status text
    CHECK (renewal_status IS NULL OR renewal_status IN (
      'pending', 'offered', 'accepted', 'rejected', 'expired'
    )),
  ADD COLUMN IF NOT EXISTS renewal_offered_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_offered_rent numeric(12, 2),
  ADD COLUMN IF NOT EXISTS renewal_notes text;

CREATE INDEX IF NOT EXISTS idx_leases_parent ON leases (parent_lease_id)
  WHERE parent_lease_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leases_renewal_status ON leases (renewal_status)
  WHERE renewal_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leases_ends_on ON leases (ends_on)
  WHERE ends_on IS NOT NULL AND lease_status = 'active';

-- 2. Expand notification triggers for maintenance lifecycle + lease renewal
DO $$
BEGIN
  -- Add new enum values if they don't already exist
  BEGIN ALTER TYPE notification_trigger_event ADD VALUE IF NOT EXISTS 'maintenance_acknowledged'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE notification_trigger_event ADD VALUE IF NOT EXISTS 'maintenance_scheduled'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE notification_trigger_event ADD VALUE IF NOT EXISTS 'maintenance_completed'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE notification_trigger_event ADD VALUE IF NOT EXISTS 'lease_expiring_60d'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE notification_trigger_event ADD VALUE IF NOT EXISTS 'lease_renewal_offered'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TYPE notification_trigger_event ADD VALUE IF NOT EXISTS 'lease_renewal_accepted'; EXCEPTION WHEN duplicate_object THEN NULL; END;
END$$;
