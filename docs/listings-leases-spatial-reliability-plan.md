# Listings + Leases Spatial Operations Plan

Last updated: February 19, 2026
Scope: API, backend logic, and data model. UI rendering is out of scope.

## Goal
Extend listings and leases so premium inventory, co-living structures, and operational planning can scale without breaking existing contracts.

## 1) Listings (Marketing Layer)

### Requirements from product reasoning
- Layout visibility beyond photos:
  - floor plans
  - 3D virtual tours
- Geographic context:
  - points of interest (POIs)
  - walkability/transit proximity
- Co-living context:
  - explicit private vs shared space presentation metadata

### Backend implementation shape (additive)
1. Add listing metadata columns:
  - `floor_plans jsonb` (array of assets/labels)
  - `virtual_tours jsonb` (array of provider URLs/types)
  - `poi_context jsonb` (categorized POIs + distances)
  - `walkability_score smallint`, `transit_score smallint`
  - `private_space_summary text`, `shared_space_summary text`
2. Add listing validation rules:
  - JSON fields must be arrays/objects with safe shape checks
  - score bounds (0-100)
3. Keep all existing listing endpoints backward-compatible.

### Status update (implemented)
- Listing API now accepts and stores:
  - `floor_plans`, `virtual_tours`
  - `poi_context`
  - `walkability_score`, `transit_score`
  - `private_space_summary`, `shared_space_summary`
- Input normalization/validation added for:
  - JSON array/object shape
  - score bounds (0-100)
- Public listing payload now returns new spatial marketing fields.

## 2) Leases (Occupancy Layer)

### Requirements from product reasoning
- Rent-roll timeline view for managers (Gantt-like occupancy blocks)
- Fractional leasing targets:
  - lease can attach to unit, room/space, or bed
- Turnover buffers:
  - enforce 24-48h (configurable) between successive occupancies

### Backend implementation shape (additive)
1. Extend `leases`:
  - optional `space_id` -> `unit_spaces(id)`
  - optional `bed_id` -> `unit_beds(id)`
  - optional `turnover_buffer_hours` (default policy fallback)
2. Add conflict validation service:
  - check overlaps by lease target granularity (unit/space/bed)
  - enforce buffer windows at create/update
3. Add read endpoint for rent-roll data:
  - `GET /v1/leases/rent-roll`
  - filters: `org_id`, `property_id`, `unit_id`, `space_id`, `bed_id`, `from`, `to`
  - output: occupancy blocks + buffer blocks + renewal markers

### Status update (implemented)
- Lease API now accepts fractional targets and buffer controls:
  - `space_id`, `bed_id`, `turnover_buffer_hours`
- Lease create/update paths enforce:
  - target integrity (`bed -> space -> unit -> property`)
  - overlap prevention with turnover buffer windows
  - fractional collision rules:
    - same-bed conflicts are blocked
    - bed-vs-space conflicts in the same space are blocked
    - different beds in the same space are allowed
- Rent-roll endpoint added:
  - `GET /v1/leases/rent-roll`
  - accepts both `from`/`to` and `from_date`/`to_date`
  - groups timeline tracks by unit/space/bed with buffer blocks

## 3) Delivery Sequence

1. Migration wave:
  - listing metadata columns
  - lease target columns + indexes
2. API wave:
  - create/update lease validation for target + buffers
  - rent-roll endpoint
3. Rollout wave:
  - feature flags for strict buffer enforcement
  - smoke tests on co-living sample data

## 4) Test Targets

1. Listings:
  - accepts legacy listing payloads unchanged
  - validates floor plan/3D tour/POI payload shape
2. Leases:
  - unit-level overlap checks still pass
  - space/bed fractional overlap checks enforced
  - turnover buffer rejects invalid adjacent bookings
3. Rent-roll:
  - deterministic ordering by unit/space/bed
  - includes current + upcoming windows in requested range
