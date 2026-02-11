-- Migration: Marketplace V2 public UX fields
-- Date: 2026-02-11
-- Safe to run multiple times.

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS gallery_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bedrooms smallint,
  ADD COLUMN IF NOT EXISTS bathrooms numeric(4, 1),
  ADD COLUMN IF NOT EXISTS square_meters numeric(8, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_listings_bedrooms_non_negative'
  ) THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT marketplace_listings_bedrooms_non_negative
      CHECK (bedrooms IS NULL OR bedrooms >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_listings_bathrooms_non_negative'
  ) THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT marketplace_listings_bathrooms_non_negative
      CHECK (bathrooms IS NULL OR bathrooms >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_listings_square_meters_non_negative'
  ) THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT marketplace_listings_square_meters_non_negative
      CHECK (square_meters IS NULL OR square_meters >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_listings_gallery_urls_array'
  ) THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT marketplace_listings_gallery_urls_array
      CHECK (jsonb_typeof(gallery_image_urls) = 'array');
  END IF;
END $$;
