# Cloudflare Cutover Checklist (AWS ECS/ALB Origin)

Use this checklist when switching Casaora traffic from Railway/Vercel origins to AWS.

## Preconditions

- Backend ECS service is healthy behind ALB
- Backend ALB target group health check uses `GET /v1/ready`
- Frontend ECS service (if used) is healthy behind ALB
- ACM certificates are issued and attached to ALB listeners
- Smoke tests pass against the AWS origin

## Pre-Cutover (24h Before)

1. Lower Cloudflare DNS TTL for affected records (if using DNS-only records during testing)
2. Confirm Cloudflare SSL mode is `Full (strict)`
3. Review WAF rules / rate limits so they do not block ALB health checks or API clients
4. Confirm origin host headers are allowed by backend `TRUSTED_HOSTS`
5. Confirm CORS includes production frontend domains

## Pre-Cutover Validation (Same Day)

Backend checks against AWS origin:

1. `GET /v1/live` -> `200`
2. `GET /v1/ready` -> `200`
3. `GET /v1/public/listings` -> `200`
4. Authenticated `GET /v1/me` -> `200`
5. Authenticated `GET /v1/properties` -> `200`

Frontend checks against AWS origin:

1. `/` or admin entry route loads
2. Login flow works
3. Critical pages render without JS/runtime errors
4. API requests resolve to new backend origin

## Cutover

1. Update Cloudflare DNS records to point to ALB (or Cloudflare-managed origin hostname / CNAME)
2. Enable proxy (`orange cloud`) for public records once origin validation is complete
3. Purge Cloudflare cache for critical routes (frontend assets/pages)
4. Monitor:
   - Cloudflare 5xx rate
   - ALB target health
   - ECS service deployment/health
   - Backend logs (`db_auth_failure`, `db_schema_incompatible`, `db_unavailable`)

## Post-Cutover (First 30 Minutes)

1. Re-run API smoke checks through public domain
2. Validate admin login and core workflows
3. Confirm error rates and latency are stable
4. Keep Railway/Vercel services available but idle for fast rollback window

## Rollback

Rollback trigger examples:

- Backend `/v1/ready` fails
- Elevated 5xx/latency
- Auth broken for most users
- Critical admin pages unusable

Rollback steps:

1. Repoint Cloudflare DNS records back to previous origin(s)
2. Purge cache
3. Confirm backend/front-end health on previous platform
4. Capture incident notes and preserve AWS/ECS logs for diagnosis

## Notes

- Prefer one change at a time:
  - Backend cutover first
  - Frontend cutover second
  - Auth/database migrations later
- Keep Cloudflare and application-level request IDs for incident tracing
