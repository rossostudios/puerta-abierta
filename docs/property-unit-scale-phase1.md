# Property/Unit Scale Architecture (Phase 1: Data + API)

Last updated: February 19, 2026

## Goal
Unblock operations for portfolios with 20+ properties, including co-living and shared-room models, without breaking existing property/unit contracts.

## What Phase 1 Implements

### Property model extensions
- `neighborhood`
- `property_type` (`apartment_building|co_living_house|hotel|single_family|multi_family|hostel|mixed_use`)
- `building_amenities` (`jsonb[]`)
- `access_instructions`
- `shared_wifi_name`
- `shared_wifi_password`
- `asset_owner_organization_id` (optional relation to `organizations.id`)
- `asset_owner_name`

### Unit model extensions
- `unit_type` (`entire_place|private_room|shared_room|bed`)
- `condition_status` (`clean|dirty|inspecting|out_of_order`)
- `floor_level`
- `area_sqm` (kept compatible with legacy `square_meters`)
- `unit_amenities` (`jsonb[]`)
- `beds_count`
- `bed_configuration` (`jsonb[]`)
- `base_price_nightly` (kept compatible with legacy `default_nightly_rate`)
- `base_price_monthly`

### API-level compatibility behavior
- Existing create/update payloads remain valid.
- New payload aliases are supported for addressing:
  - `address_line_1 -> address_line1`
  - `address_line_2 -> address_line2`
- Unit write paths mirror aliases:
  - `base_price_nightly <-> default_nightly_rate`
  - `area_sqm <-> square_meters`
- Listing endpoints now support additional filters:
  - `GET /v1/properties?property_type=&neighborhood=`
  - `GET /v1/units?unit_type=&condition_status=&floor_level=`

## Migration
- File: `db/migrations/2026-02-19_property-unit-portfolio-scale.sql`
- Scope:
  - additive columns
  - data backfill for alias fields
  - indexes for type/status filtering
  - check constraints for enum-like text/jsonb shape

## Deferred to Phase 2 (UI/UX)
- Building → floor → unit → room/bed hierarchy explorer
- Status matrix/tape-chart view for occupancy + housekeeping
- bulk operations (pricing/status by criteria)

## Rollout Notes
1. Apply migration in staging and validate create/update/list for `properties` and `units`.
2. Run compatibility checks on existing unit pricing and area fields.
3. Enable UI controls for new columns in a separate frontend-focused phase.
