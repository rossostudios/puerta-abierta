-- Migration: Marketplace listing completeness fields
-- Date: 2026-02-12
-- Safe to run multiple times.

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS property_type text,
  ADD COLUMN IF NOT EXISTS furnished boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pet_policy text,
  ADD COLUMN IF NOT EXISTS parking_spaces smallint,
  ADD COLUMN IF NOT EXISTS minimum_lease_months smallint,
  ADD COLUMN IF NOT EXISTS available_from date,
  ADD COLUMN IF NOT EXISTS amenities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS maintenance_fee numeric(12, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_listings_parking_spaces_non_negative'
  ) THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT marketplace_listings_parking_spaces_non_negative
      CHECK (parking_spaces IS NULL OR parking_spaces >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_listings_min_lease_months_positive'
  ) THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT marketplace_listings_min_lease_months_positive
      CHECK (minimum_lease_months IS NULL OR minimum_lease_months >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_listings_amenities_array'
  ) THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT marketplace_listings_amenities_array
      CHECK (jsonb_typeof(amenities) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_listings_maintenance_fee_non_negative'
  ) THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT marketplace_listings_maintenance_fee_non_negative
      CHECK (maintenance_fee >= 0);
  END IF;
END $$;
