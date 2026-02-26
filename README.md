# Casaora

AWS + Cloudflare platform for short-term rental operations in Paraguay, with:
- `Axum + SQLx` Rust backend (`apps/backend-rs`)
- `Next.js` admin frontend (`apps/admin`)
- `Next.js` public marketing/portal app (`apps/web`)
- Mobile app intentionally deferred (will be rebuilt later)
- PostgreSQL schema and RLS policies (`db/schema.sql`)
- PRD and API contract (`docs/PRD.md`, `api/openapi.yaml`)

## Project Structure

- `apps/backend-rs`: Rust/Axum API server with all `/v1` routers
- `apps/admin`: Next.js admin console wired to API modules
- `apps/web`: Next.js public-facing web app
- `packages/shared-api`: shared API helpers + OpenAPI type exports
- `db/schema.sql`: Multi-tenant Postgres schema compatible with Supabase and Neon
- `api/openapi.yaml`: Endpoint contract
- `docs/PRD.md`: Product requirements
- `docs/vercel-deploy.md`: Production/Vercel deployment checklist
- `docs/codex-workflow.md`: Codex + MCP execution workflow

## 1) Database Setup

1. Create a PostgreSQL database (AWS RDS is the production target).
2. Apply the schema:
   - Option A (manual): Open SQL Editor and run `db/schema.sql`.
   - Option B (script): Run `python3 scripts/supabase/execute_sql.py --project-ref <ref> --sql-file db/schema.sql`
     - Requires a Supabase Personal Access Token (PAT) via `SUPABASE_ACCESS_TOKEN`.
3. Set your connection string:
   - `DATABASE_URL` (preferred)
   - `SUPABASE_DB_URL` (legacy alias, still supported)

## 2) Backend Setup (Rust/Axum)

```bash
cd /Users/christopher/Desktop/puerta-abierta/apps/backend-rs
cp .env.example .env
```

Update `.env` with your database/auth values and optional defaults:
- `DATABASE_URL`
- `CLERK_JWKS_URL`
- `CLERK_ISSUER_URL`
- `DEFAULT_ORG_ID`
- `DEFAULT_USER_ID`

Build and run:

```bash
cargo run
```

The backend listens on port `8000` by default. Health check: `GET http://localhost:8000/v1/health`.

## 3) Frontend Setup (Next.js Admin)

```bash
cd /Users/christopher/Desktop/puerta-abierta/apps/admin
cp .env.example .env.local
```

Set:
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/v1` (points to the Rust backend)
- `NEXT_PUBLIC_DEFAULT_ORG_ID=<org_uuid>`

Install and run:

```bash
npm install
npm run dev
```

Admin app:
- `http://localhost:3000`

## 4) Mobile App

The mobile app has been intentionally removed from this branch and will be rebuilt later.

## Current Module Coverage

- Organizations + members
- Properties + units
- Integrations (channels, listings)
- Guests
- Reservations + status transitions
- Calendar blocks + availability
- Tasks
- Expenses
- Owner statements
- Messaging templates + send logs
- Owner summary report

## Notes

- This scaffold is intentionally implementation-first and schema-aligned.
- Business logic is starter-level; production rollout should add:
  - stronger auth enforcement
  - audit hooks on all writes
  - idempotency keys for external sync
  - background jobs for iCal and messaging dispatch

## Codex Quality Gate

Run this before merge/deploy:

```bash
./scripts/quality-gate.sh
```

Fast mode (skip admin build):

```bash
./scripts/quality-gate.sh fast
```
