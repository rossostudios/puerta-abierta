# Casaora Agent Guide

This repository runs a dual-app stack:
- `apps/admin`: Next.js 16 admin + public marketplace
- `apps/backend-rs`: Rust/Axum backend with Supabase table-service routers

## Operating Rules

1. Always validate with the latest docs when requirements are time-sensitive.
2. Prefer MCP-backed docs access first:
   - Exa MCP for general ecosystem docs.
   - OpenAI Docs MCP for OpenAI/Codex guidance.
3. If MCP is unavailable, fall back to official source websites.
4. Keep schema/API/frontend changes synchronized in the same PR whenever possible.

## Fast Project Map

- Product/roadmap: `docs/PRD.md`
- SQL schema + migrations: `db/schema.sql`, `db/migrations/*.sql`
- Backend routers: `apps/backend-rs/src/routes/*.rs`
- Frontend admin/public modules: `apps/admin/app/**/*`
- Shared UI primitives: `apps/admin/components/ui/*`

## Required Quality Gates

Run this before merge/deploy:

```bash
./scripts/quality-gate.sh
```

Fast mode (no admin build):

```bash
./scripts/quality-gate.sh fast
```

## Deployment Guardrail

Before pushing to production (Vercel + Railway):

1. Apply pending SQL migrations to production DB.
2. Confirm admin env points to Railway backend API URL.
3. Run `./scripts/quality-gate.sh`.
4. Verify `/marketplace`, `/module/applications`, `/module/leases`, `/module/owner-statements` manually.

