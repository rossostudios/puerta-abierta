-- Listings spatial marketing metadata (additive, backward-compatible)
-- Supports floor plans, virtual tours, location context, and co-living space framing.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS floor_plans jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS virtual_tours jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS poi_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS walkability_score smallint,
  ADD COLUMN IF NOT EXISTS transit_score smallint,
  ADD COLUMN IF NOT EXISTS private_space_summary text,
  ADD COLUMN IF NOT EXISTS shared_space_summary text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listings_floor_plans_array'
      AND conrelid = 'listings'::regclass
  ) THEN
    ALTER TABLE listings
      ADD CONSTRAINT listings_floor_plans_array
      CHECK (jsonb_typeof(floor_plans) = 'array');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listings_virtual_tours_array'
      AND conrelid = 'listings'::regclass
  ) THEN
    ALTER TABLE listings
      ADD CONSTRAINT listings_virtual_tours_array
      CHECK (jsonb_typeof(virtual_tours) = 'array');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listings_poi_context_object'
      AND conrelid = 'listings'::regclass
  ) THEN
    ALTER TABLE listings
      ADD CONSTRAINT listings_poi_context_object
      CHECK (jsonb_typeof(poi_context) = 'object');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listings_walkability_score_range'
      AND conrelid = 'listings'::regclass
  ) THEN
    ALTER TABLE listings
      ADD CONSTRAINT listings_walkability_score_range
      CHECK (
        walkability_score IS NULL
        OR (walkability_score >= 0 AND walkability_score <= 100)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listings_transit_score_range'
      AND conrelid = 'listings'::regclass
  ) THEN
    ALTER TABLE listings
      ADD CONSTRAINT listings_transit_score_range
      CHECK (
        transit_score IS NULL
        OR (transit_score >= 0 AND transit_score <= 100)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_listings_org_scores
  ON listings(organization_id, walkability_score, transit_score);
