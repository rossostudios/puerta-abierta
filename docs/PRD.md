# Casaora - Product Requirements Document (PRD)

Version: 1.0  
Date: February 6, 2026  
Author: Codex

## 1. Product Summary

Casaora is an operations platform for short-term rental (STR) owners and managers in Paraguay. It centralizes reservations, calendar availability, cleaning and maintenance workflows, and owner financial reporting in one system.

Primary market:
- Paraguay-based STR owners managing 2 to 50 units.
- Small management teams coordinating cleaners, maintenance, and guest messaging.

Primary language and localization:
- Default UI language: Spanish (`es-PY`)
- Time zone default: `America/Asuncion`
- Currency support: `PYG` and `USD`

## 2. Problem Statement

Owners and operators currently manage operations across WhatsApp chats, spreadsheets, and OTA dashboards (Airbnb, Booking.com). This causes:
- Missed turnovers and delayed cleanings
- Calendar conflicts and manual availability errors
- Weak financial visibility by property/unit
- Slow monthly owner reporting

## 3. Goals and Non-Goals

### Goals
- Centralize operations for multi-property STR teams.
- Reduce operational mistakes (double bookings, missed tasks).
- Provide clear monthly owner statements with net payout visibility.
- Support Paraguay-specific operation needs (RUC/invoice references, PYG/USD).

### Non-Goals (Phase 1)
- Not building a full channel manager with deep OTA API write-sync on day 1.
- Not replacing accounting/ERP systems.
- Not building direct in-app payment processing as a hard dependency for launch.

## 4. Users and Roles

### Owner Admin
- Creates organization, invites team, configures properties/units.
- Views financial dashboards and statements.

### Operator
- Manages reservations, blocks, check-ins, and task assignments.

### Cleaner / Field Staff
- Receives cleaning/inspection tasks, marks checklist completion.

### Accountant / Finance
- Tracks expenses, reviews statements, exports reports.

### Viewer
- Read-only access for partners or assistants.

## 5. Core Jobs To Be Done

- "When I receive bookings from multiple channels, I want one calendar so I can avoid conflicts."
- "When a guest checks out, I want cleaning tasks auto-created so turnover is never missed."
- "At month-end, I want property-level revenue/expense/net payout reports I can send to owners."
- "When issues happen, I want audit logs and event history to trace decisions."

## 6. Scope by Release

### MVP (must-have)
- Multi-tenant organizations and member roles
- Properties, units, channels, and listings
- Reservation management with overlap protection
- Calendar blocks (manual + imported context)
- Guest records
- Task management for cleaning/maintenance/check-in/out
- Expense tracking by property/unit/reservation
- Owner statements (draft -> finalized -> sent -> paid)
- Message templates and send log
- Basic reports (occupancy, revenue, net payout)

### Phase 2
- Deeper channel API integrations (beyond iCal)
- Automated dynamic pricing recommendations
- Vendor portal for maintenance teams
- Advanced SLA and escalation engine

### Phase 3
- Mobile-first staff app
- AI-assisted guest communication and task triage

## 7. Functional Requirements

### FR-1 Identity and Access
- Users can belong to multiple organizations.
- Every organization has role-based access control (`owner_admin`, `operator`, `cleaner`, `accountant`, `viewer`).
- API must enforce tenant isolation for all organization-scoped data.

### FR-2 Properties and Units
- Users can create properties with one or more units.
- Each unit stores capacity, check-in/out defaults, and default rates.
- Units can be active/inactive without deleting historical data.

### FR-3 Channels and Listings
- Organization can define channels (`airbnb`, `bookingcom`, `direct`, `vrbo`, `other`).
- Unit can have one listing per channel.
- Listing supports iCal import URL and secure export token.

### FR-4 Reservations and Calendar
- Reservation records include status lifecycle and financial fields.
- System must reject overlapping active reservations for the same unit.
- Calendar blocks can be created for maintenance/owner use and prevent availability.
- Reservation status transitions are explicit and auditable.

### FR-5 Guests
- Guest profile stores contact and optional document metadata.
- Guests can be linked to multiple reservations over time.

### FR-6 Task Operations
- Tasks are linked to unit and optionally reservation.
- Task types include cleaning, maintenance, check-in, check-out, inspection, custom.
- Tasks support assignees, priority, due time, and checklist items.

### FR-7 Finance and Statements
- Expenses can be tracked at reservation, unit, or property level.
- Expenses store method, currency, FX rate snapshot, and invoice references.
- Statements aggregate period totals and support status workflow.

### FR-8 Messaging
- Templates support WhatsApp/email/SMS content with variables.
- Outbound send attempts are logged with status and provider response payload.

### FR-9 Reporting
- API supports owner summary report by date range.
- Minimum metrics: occupancy, gross revenue, expenses, net payout.

### FR-10 Audit and Integrations
- Integration event table captures inbound webhook payloads and processing state.
- Audit log records critical create/update/delete and status transitions.

## 8. Non-Functional Requirements

- Availability target: 99.9% monthly uptime (MVP goal).
- API p95 latency under 300 ms for key list/detail endpoints under expected load.
- PostgreSQL ACID transactions for booking and financial writes.
- Security baseline:
  - JWT-based authentication
  - Role-based authorization
  - RLS (if Supabase)
  - At-rest encryption (managed by provider)
- Observability:
  - Request logs with correlation ID
  - Structured error payloads
  - Audit entries for financial and reservation state changes

## 9. Localization and Paraguay Requirements

- Default locale: `es-PY`
- Default timezone: `America/Asuncion`
- Currency:
  - Default org currency: `PYG`
  - Optional transactional currency: `USD`
  - Store FX snapshot when non-default currency used in expenses/reservations
- Finance metadata:
  - Optional `invoice_number`
  - Optional `invoice_ruc`

Note: local legal/tax obligations vary by business model. Final tax logic should be validated with a Paraguay accountant before production.

## 10. Key Metrics

- Operational:
  - Task completion rate before due time
  - Missed turnover count per month
  - Reservation conflict count
- Business:
  - Occupancy %
  - Gross revenue per available night (RevPAN)
  - Net payout per property/unit
- Product:
  - Weekly active operators
  - Monthly statements generated and sent

## 11. Architecture Decision: Supabase vs Neon

### Recommendation: Supabase-first for MVP

Why:
- Managed Postgres plus built-in Auth, Storage, and optional Realtime.
- Native RLS workflow accelerates secure multi-tenant implementation.
- Faster initial delivery with fewer external services.

### Neon remains a valid option when:
- You want pure Postgres and custom auth stack.
- You prioritize branching workflows and infrastructure control.

### Implementation approach in this repo
- Database schema stays PostgreSQL-compatible for both Supabase and Neon.
- RLS helper/policies are included as optional SQL (best fit for Supabase).

## 12. API and Data Principles

- API style: REST JSON (`/v1/...`)
- Idempotency:
  - Support idempotent create patterns for external reservation sync.
- Monetary values:
  - Use `numeric(12,2)` in DB.
  - Always include explicit currency.
- Dates:
  - Use ISO 8601 date/time.
  - Reservation availability uses `[check_in, check_out)` semantics.

## 13. Milestones

### Milestone 1 (Weeks 1-3)
- Auth + org membership
- Properties/units/channels/listings
- Reservation CRUD with overlap constraint

### Milestone 2 (Weeks 4-6)
- Tasks + checklist workflows
- Calendar blocks and availability endpoint
- Guest profiles

### Milestone 3 (Weeks 7-9)
- Expenses and owner statements
- Reporting endpoints
- Message templates and logs

### Milestone 4 (Weeks 10-12)
- Pilot onboarding for 3 to 5 owner accounts
- Performance hardening and bug fixes

## 14. Risks and Mitigations

- Risk: Incorrect status transitions and double-bookings.
  - Mitigation: DB-level overlap exclusion + strict transition logic.
- Risk: Weak finance trust due to inconsistent expense tagging.
  - Mitigation: required categories, validation, and audit logs.
- Risk: Slow adoption by field staff.
  - Mitigation: simple task UX, Spanish-first copy, mobile-friendly endpoints.

## 15. Out of Scope (Current Version)

- In-app OTA billing reconciliation.
- Marketplace payments escrow.
- Dynamic pricing automation as default system behavior.

