# Vercel + Railway Deployment Checklist

Use this split deployment:

- Admin (`apps/admin`) on Vercel
- Backend (`apps/backend`) on Railway

## 1) Backend project (`apps/backend`) on Railway

Root directory: `apps/backend`

Config-as-code in repo:

- `apps/backend/railway.toml` sets:
  - `startCommand = "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"`
  - `healthcheckPath = "/v1/health"`
- `apps/backend/.python-version` pins Python `3.12`

Required environment variables:

- `ENVIRONMENT=production`
- `API_PREFIX=/v1`
- `CORS_ORIGINS=https://<your-admin-domain>`
- `TRUSTED_HOSTS=<your-backend-domain>,<any-custom-domain>,*.up.railway.app`
- `SUPABASE_URL=<your-supabase-url>`
- `SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>`

Optional:

- `DOCS_ENABLED=false` (already disabled automatically in production)
- `DEV_AUTH_OVERRIDES_ENABLED=false` (already disabled automatically in production)

Smoke checks:

- `GET https://<backend-domain>/v1/health` returns `200`
- `GET https://<backend-domain>/docs` returns `404`

## 2) Admin project (`apps/admin`) on Vercel

Root directory: `apps/admin`

Required environment variables:

- `NEXT_PUBLIC_API_BASE_URL=https://<backend-domain>/v1`
- `NEXT_PUBLIC_SITE_URL=https://<admin-domain>`
- `NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>`

Optional:

- `API_TIMEOUT_MS=15000`
- `NEXT_PUBLIC_DEFAULT_ORG_ID=<org-uuid>`

Smoke checks:

- `GET https://<admin-domain>/login` returns `200`
- `GET https://<admin-domain>/` redirects to `/login` when signed out
- `GET https://<admin-domain>/api/me` returns `401` when signed out

## 3) Optional: backend on Vercel

`apps/backend/vercel.json` and `apps/backend/api/index.py` are kept if you want to run the backend on Vercel later, but Railway is the recommended host for this FastAPI service shape.
