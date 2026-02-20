# Launch Cost Baseline (First 10 Users)

Last updated: February 19, 2026

## Scope Assumptions
- Commercial/public launch
- Production-only always-on environment
- Core API and workflow queue enabled
- AI agents enabled with approval-first write governance

## Recommended Stack
- Vercel Pro: `$20/month`
- Railway Hobby: `$5/month`
- Supabase Pro: `~$25/month` (verify at checkout)
- OpenAI API: variable (token-based; monitor daily)

Estimated fixed monthly baseline (excluding variable AI): `~$50/month`

## Lean Minimum (Higher Risk)
- Vercel Pro: `$20/month`
- Railway Hobby: `$5/month`
- Supabase Free: `$0`

Estimated fixed monthly baseline: `~$25/month`

Tradeoff: lower database reliability headroom versus Pro.

## Cost Guardrails
- Set `AI_AGENT_ENABLED=true` with strict approval-first tool policies.
- Keep write tools in `required` mode by default (`create_row`, `update_row`, `delete_row`).
- Keep outbound paid messaging automations disabled until needed.
- Cap model fallback chain and monitor daily token burn.

## Required Production Env (Backend)
- `WORKFLOW_ENGINE_MODE=queue`
- `INTERNAL_API_KEY=<strong-random-secret>`
- `WORKFLOW_QUEUE_ORG_ALLOWLIST=`
- `AI_AGENT_ENABLED=true`
- `OPENAI_PRIMARY_MODEL=<model>`
- `OPENAI_FALLBACK_MODELS=<comma-separated-models>`

## Required Scheduler
- Run every minute:
  - `POST /v1/internal/process-workflow-jobs?limit=100`
  - Header `x-api-key: <INTERNAL_API_KEY>`
- Run every 10 minutes:
  - `POST /v1/reports/anomalies/scan?org_id=<ORG_ID>`
  - Header `Authorization: Bearer <operator-token>`
- Run daily:
  - `POST /v1/internal/notifications-retention`
  - Header `x-api-key: <INTERNAL_API_KEY>`

## Official Pricing and Limits References
- [Vercel Pricing](https://vercel.com/pricing)
- [Vercel Plan Usage Limits](https://vercel.com/docs/plans/usage)
- [Vercel Cron Limits](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Railway Pricing](https://railway.com/pricing)
- [Railway Plan Overview](https://docs.railway.com/reference/pricing/plans-overview)
- [Supabase Usage-Based Pricing and Quotas](https://supabase.com/docs/guides/platform/manage-your-usage/usage-based-pricing)
- [Supabase Billing Behavior](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Supabase Pricing](https://supabase.com/pricing)
