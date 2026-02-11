# Puerta Abierta

Supabase-first platform scaffold for short-term rental operations in Paraguay, with:
- `FastAPI` backend (`apps/backend`)
- `Next.js` admin frontend (`apps/admin`)
- PostgreSQL schema and RLS policies (`db/schema.sql`)
- PRD and API contract (`docs/PRD.md`, `api/openapi.yaml`)

## Project Structure

- `apps/backend`: FastAPI API server with PRD module routers
- `apps/admin`: Next.js admin console wired to API modules
- `db/schema.sql`: Multi-tenant Postgres schema compatible with Supabase and Neon
- `api/openapi.yaml`: Endpoint contract
- `docs/PRD.md`: Product requirements
- `docs/vercel-deploy.md`: Production/Vercel deployment checklist

## 1) Supabase Setup

1. Create a Supabase project.
2. Apply the schema:
   - Option A (manual): Open SQL Editor and run `db/schema.sql`.
   - Option B (script): Run `python3 scripts/supabase/execute_sql.py --project-ref <ref> --sql-file db/schema.sql`
     - Requires a Supabase Personal Access Token (PAT) via `SUPABASE_ACCESS_TOKEN`.
3. Copy your project credentials:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 2) Backend Setup (FastAPI)

```bash
cd /Users/christopher/Desktop/puerta-abierta/apps/backend
cp .env.example .env
```

Update `.env` with your Supabase values and optional defaults:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEFAULT_ORG_ID`
- `DEFAULT_USER_ID`

Install and run:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Docs:
- Swagger UI: `http://localhost:8000/docs`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

## 3) Frontend Setup (Next.js Admin)

```bash
cd /Users/christopher/Desktop/puerta-abierta/apps/admin
cp .env.example .env.local
```

Set:
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/v1`
- `NEXT_PUBLIC_DEFAULT_ORG_ID=<org_uuid>`

Install and run:

```bash
npm install
npm run dev
```

Admin app:
- `http://localhost:3000`

## Current Module Coverage

- Organizations + members
- Properties + units
- Channels + listings
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
