-- Phase 2B: backfill + compatibility mirrors for hierarchy rollout.
-- - Backfill property floors from units.floor_level.
-- - Backfill canonical unit_beds from legacy units.bed_configuration and beds_count.
-- Idempotent and safe to re-run.

-- 1) Floors backfill
INSERT INTO property_floors (
  organization_id,
  property_id,
  label,
  number,
  sort_order
)
SELECT DISTINCT
  u.organization_id,
  u.property_id,
  CASE
    WHEN u.floor_level = 0 THEN 'Ground Floor'
    WHEN u.floor_level < 0 THEN format('Basement %s', abs(u.floor_level))
    ELSE format('Floor %s', u.floor_level)
  END AS label,
  u.floor_level AS number,
  u.floor_level::integer AS sort_order
FROM units u
WHERE u.floor_level IS NOT NULL
ON CONFLICT (property_id, number) DO NOTHING;

-- 2) Beds backfill from legacy bed_configuration (for units without canonical beds yet)
WITH units_without_beds AS (
  SELECT
    u.id AS unit_id,
    u.organization_id,
    u.property_id,
    coalesce(u.bed_configuration, '[]'::jsonb) AS bed_configuration
  FROM units u
  WHERE NOT EXISTS (
    SELECT 1
    FROM unit_beds existing
    WHERE existing.unit_id = u.id
  )
    AND jsonb_typeof(coalesce(u.bed_configuration, '[]'::jsonb)) = 'array'
    AND jsonb_array_length(coalesce(u.bed_configuration, '[]'::jsonb)) > 0
),
expanded AS (
  SELECT
    u.unit_id,
    u.organization_id,
    u.property_id,
    item.value AS item,
    item.ordinality::integer AS ordinality
  FROM units_without_beds u
  CROSS JOIN LATERAL jsonb_array_elements(u.bed_configuration) WITH ORDINALITY AS item(value, ordinality)
),
exploded AS (
  SELECT
    e.unit_id,
    e.organization_id,
    e.property_id,
    e.item,
    e.ordinality,
    greatest(
      1,
      least(
        50,
        coalesce(
          CASE
            WHEN jsonb_typeof(e.item) = 'object'
                 AND coalesce(e.item ->> 'count', '') ~ '^[0-9]+$'
            THEN (e.item ->> 'count')::integer
          END,
          CASE
            WHEN jsonb_typeof(e.item) = 'object'
                 AND coalesce(e.item ->> 'quantity', '') ~ '^[0-9]+$'
            THEN (e.item ->> 'quantity')::integer
          END,
          CASE
            WHEN jsonb_typeof(e.item) = 'object'
                 AND coalesce(e.item ->> 'qty', '') ~ '^[0-9]+$'
            THEN (e.item ->> 'qty')::integer
          END,
          1
        )
      )
    ) AS item_count
  FROM expanded e
),
expanded_counts AS (
  SELECT
    e.unit_id,
    e.organization_id,
    e.property_id,
    e.item,
    e.ordinality,
    count_series.index
  FROM exploded e
  CROSS JOIN LATERAL generate_series(1, e.item_count) AS count_series(index)
),
normalized AS (
  SELECT
    ec.unit_id,
    ec.organization_id,
    ec.property_id,
    (((ec.ordinality - 1) * 100) + ec.index - 1)::integer AS sort_order,
    CASE
      WHEN jsonb_typeof(ec.item) = 'object'
      THEN nullif(
        btrim(
          coalesce(
            ec.item ->> 'code',
            ec.item ->> 'bed_code',
            ec.item ->> 'label',
            ''
          )
        ),
        ''
      )
    END AS raw_code,
    CASE
      WHEN jsonb_typeof(ec.item) = 'object'
      THEN lower(
        coalesce(
          nullif(ec.item ->> 'bed_type', ''),
          nullif(ec.item ->> 'type', ''),
          'single'
        )
      )
      WHEN jsonb_typeof(ec.item) = 'string'
      THEN lower(trim(both '"' FROM ec.item::text))
      ELSE 'single'
    END AS raw_bed_type,
    CASE
      WHEN jsonb_typeof(ec.item) = 'object'
      THEN lower(coalesce(nullif(ec.item ->> 'status', ''), 'available'))
      ELSE 'available'
    END AS raw_status,
    CASE
      WHEN jsonb_typeof(ec.item) = 'object'
      THEN nullif(ec.item ->> 'notes', '')
    END AS notes
  FROM expanded_counts ec
),
coded AS (
  SELECT
    n.unit_id,
    n.organization_id,
    n.property_id,
    n.sort_order,
    coalesce(n.raw_code, format('BED-%s', n.sort_order + 1)) AS base_code,
    n.raw_bed_type,
    n.raw_status,
    n.notes
  FROM normalized n
),
deduped AS (
  SELECT
    c.*,
    row_number() OVER (
      PARTITION BY c.unit_id, lower(c.base_code)
      ORDER BY c.sort_order, c.base_code
    ) AS duplicate_rank
  FROM coded c
)
INSERT INTO unit_beds (
  organization_id,
  property_id,
  unit_id,
  code,
  bed_type,
  status,
  sort_order,
  notes
)
SELECT
  d.organization_id,
  d.property_id,
  d.unit_id,
  CASE
    WHEN d.duplicate_rank = 1 THEN d.base_code
    ELSE format('%s-%s', d.base_code, d.duplicate_rank)
  END AS code,
  CASE
    WHEN d.raw_bed_type IN ('single', 'twin', 'double', 'queen', 'king', 'bunk', 'sofa_bed', 'other')
    THEN d.raw_bed_type
    WHEN d.raw_bed_type IN ('bunk bed', 'bunk_bed')
    THEN 'bunk'
    WHEN d.raw_bed_type IN ('sofabed', 'sofa bed', 'sofa')
    THEN 'sofa_bed'
    ELSE 'single'
  END AS bed_type,
  CASE
    WHEN d.raw_status IN ('available', 'occupied', 'reserved', 'dirty', 'inspecting', 'out_of_order', 'blocked')
    THEN d.raw_status
    WHEN d.raw_status = 'clean'
    THEN 'available'
    ELSE 'available'
  END AS status,
  d.sort_order,
  d.notes
FROM deduped d
ON CONFLICT (unit_id, code) DO NOTHING;

-- 3) Fallback bed rows from beds_count for any unit still without canonical beds.
WITH units_without_beds AS (
  SELECT
    u.id AS unit_id,
    u.organization_id,
    u.property_id,
    greatest(1, least(coalesce(u.beds_count, 1), 50))::integer AS desired_count
  FROM units u
  WHERE NOT EXISTS (
    SELECT 1
    FROM unit_beds existing
    WHERE existing.unit_id = u.id
  )
)
INSERT INTO unit_beds (
  organization_id,
  property_id,
  unit_id,
  code,
  bed_type,
  status,
  sort_order
)
SELECT
  u.organization_id,
  u.property_id,
  u.unit_id,
  format('BED-%s', series.index) AS code,
  'single' AS bed_type,
  'available' AS status,
  series.index - 1 AS sort_order
FROM units_without_beds u
CROSS JOIN LATERAL generate_series(1, u.desired_count) AS series(index)
ON CONFLICT (unit_id, code) DO NOTHING;
