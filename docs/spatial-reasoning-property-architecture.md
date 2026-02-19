# Spatial Reasoning & Property Management Architecture Analysis

Last updated: February 19, 2026
Scope: Backend API, data model, workflow logic. UI implementation is out of scope in this phase.

## 1) Problem Statement

Current property/unit modeling supports a flat listing model but does not fully represent large mixed portfolios (multi-family, co-living, shared-room, bed-level leasing) with operational workflows at scale.

## 2) Current-State Coverage vs Gaps

### Implemented in Phase 1 (already in repo)
- Property-level expansion:
  - fuller location/profile metadata (`address_line2`, `region`, `neighborhood`, `postal_code`, `property_type`)
  - building operations fields (`access_instructions`, shared WiFi fields)
  - ownership relation support (`asset_owner_organization_id`, `asset_owner_name`)
  - building amenities (`building_amenities`)
- Unit-level expansion:
  - co-living classification (`unit_type`)
  - operational housekeeping status (`condition_status`)
  - physical details (`floor_level`, `area_sqm`)
  - capacity details (`beds_count`, `bed_configuration`)
  - financial defaults (`base_price_nightly`, `base_price_monthly`)
  - unit amenities (`unit_amenities`)
- API compatibility:
  - alias normalization and legacy field mirroring for existing clients
  - additive filtering on property/unit list endpoints

### Implemented in Phase 2A (data shape)
- Canonical hierarchy tables are now defined:
  - `property_floors`
  - `unit_spaces`
  - `unit_beds`
  - `unit_condition_events`
- Indexes added for hierarchy/status access patterns:
  - `(organization_id, property_id, sort_order)`
  - `(organization_id, unit_id, status)`
  - `(organization_id, floor_id, status)`

### Implemented in Phase 2B (backfill + dual-write)
- Data backfill migration:
  - floor rows seeded from `units.floor_level`
  - canonical `unit_beds` seeded from `units.bed_configuration` and fallback `beds_count`
- Dual-write behavior in unit write paths:
  - create/update unit now syncs `property_floors` from floor metadata
  - create/update unit now syncs canonical `unit_beds` while preserving legacy JSON mirrors

### Implemented in Phase 2C (read cutover start)
- Additive hierarchy read endpoint:
  - `GET /v1/properties/{id}/hierarchy`
  - returns `property -> floors -> units -> spaces -> beds` with unassigned unit fallback
- Additive bulk mutation endpoint with preview mode:
  - `POST /v1/units/bulk-update`
  - supports scoped filters (`property_id`, `unit_ids`, `floor_level`, `unit_type`, `condition_status`, `bedrooms`, `is_active`)
  - supports `dry_run=true` preview and capped apply execution

### Remaining gaps for full spatial reasoning
- Occupancy + operations matrix backend support:
  - denormalized rollups for occupancy/housekeeping by floor/unit/room/bed
  - query endpoints optimized for grid/tape-chart views

## 3) Target Canonical Data Model

### New tables (additive)
1. `property_floors`
  - `id`, `organization_id`, `property_id`, `label`, `number`, `has_elevator_access`, `sort_order`
2. `unit_spaces`
  - Represents spaces inside a unit: room, alcove, shared zone.
  - `id`, `organization_id`, `property_id`, `unit_id`, `floor_id`, `space_type`, `name`, `max_occupancy`, `status`
3. `unit_beds`
  - First-class bed inventory.
  - `id`, `organization_id`, `property_id`, `unit_id`, `space_id`, `bed_type`, `code`, `status`

### Optional relation updates (future-safe)
- Reservations/leases can reference `space_id` and/or `bed_id` when applicable.
- Keep `unit_id` as required for backward compatibility.

## 4) Workflow/Operational Logic Requirements

### Housekeeping state-machine
- Supported statuses: `clean`, `dirty`, `inspecting`, `out_of_order`.
- Transition guards:
  - `clean -> dirty|inspecting|out_of_order`
  - `dirty -> inspecting|out_of_order`
  - `inspecting -> clean|dirty|out_of_order`
  - `out_of_order -> inspecting`
- Reject invalid transitions with explicit API errors.
- Persist transition audit rows in `unit_condition_events`.

### Trigger semantics
- Emit domain events at most once per state transition:
  - `unit_condition_changed`
  - `bed_occupied`
  - `bed_released`
  - keep existing workflow events additive (no breaking renames)

## 5) API Additions (Non-breaking)

1. `GET /v1/properties/{id}/hierarchy`
  - Returns building -> floor -> unit -> room -> bed tree in one payload.
2. `POST /v1/units/bulk-update`
  - Supports predicate-driven updates (`property_id`, `floor_level`, `unit_type`, `condition_status`).
  - Supports `dry_run=true` preview mode.
3. `GET /v1/operations/status-matrix`
  - Returns occupancy + housekeeping status rows for operational dashboards.

Existing property/unit CRUD endpoints remain unchanged and continue to accept legacy payload shapes.

## 6) Migration Strategy (Phased)

### Phase 2A: Data shape
- Add `property_floors`, `unit_spaces`, `unit_beds`, `unit_condition_events`.
- Add indexes for common filters:
  - `(organization_id, property_id, sort_order)`
  - `(organization_id, unit_id, status)`
  - `(organization_id, floor_id, status)`

### Phase 2B: Backfill + dual-write
- Backfill initial floor rows from existing `units.floor_level`.
- Convert `bed_configuration` JSON entries into `unit_beds` rows.
- Keep JSON fields as compatibility mirrors during transition.

### Phase 2C: Read cutover
- Make hierarchy/status APIs read primarily from canonical tables.
- Retain JSON mirrors for older clients until deprecation window ends.

## 7) Reliability & Observability

- Add run metrics for bulk operations:
  - affected rows, skipped rows, failure rows.
- Add audit records for unit/bed status transitions.
- Add SLO checks:
  - status write latency p95
  - invalid transition rate
  - hierarchy query latency p95

## 8) Testing Matrix

1. Unit: status transition validator allows only legal edges.
2. Unit: bed-level occupancy transitions keep unit-level occupancy aggregates consistent.
3. Integration: hierarchy endpoint returns deterministic tree ordering.
4. Integration: bulk update `dry_run` returns same count as actual run.
5. Regression: legacy property/unit create/update payloads still succeed.
6. Regression: existing workflow rules continue to execute with no contract changes.

## 9) Immediate Execution Order

1. Ship Phase 2A migration tables (no read-path behavior changes).
2. Add service-layer transition validator + audit logging.
3. Add hierarchy read endpoint.
4. Add bulk update endpoint with dry-run and transaction safety.
5. Add status matrix endpoint with query/index tuning.
