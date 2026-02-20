# Workflow Engine Runbook

## Production Launch Profile (First 10 Users)
Use this env profile for a reliability-first, low-cost launch:

- `WORKFLOW_ENGINE_MODE=queue`
- `INTERNAL_API_KEY=<strong-random-secret>`
- `WORKFLOW_QUEUE_ORG_ALLOWLIST=` (empty = all orgs)
- `AI_AGENT_ENABLED=true`

In production, `/v1/internal/process-workflow-jobs` now fails closed if
`INTERNAL_API_KEY` is not configured.

## Modes
- `WORKFLOW_ENGINE_MODE=legacy`
  - Uses inline execution.
  - Delayed actions rely on in-process sleep.
- `WORKFLOW_ENGINE_MODE=queue`
  - Uses durable `workflow_jobs` queue.
  - Retries and attempt history are persisted.

Default is `legacy`.

Optional canary org allowlist (only evaluated in `queue` mode):
- `WORKFLOW_QUEUE_ORG_ALLOWLIST=<org_uuid_1>,<org_uuid_2>`

## Scheduler
Create a 1-minute cron that calls:

- `POST /v1/internal/process-workflow-jobs`
- Header: `x-api-key: <INTERNAL_API_KEY>`

Optional query:
- `limit=<1..500>` (default `100`)

Example call:

```bash
curl -sS -X POST \
  "https://<backend-domain>/v1/internal/process-workflow-jobs?limit=100" \
  -H "x-api-key: <INTERNAL_API_KEY>"
```

Railway scheduler assets in this repo:

- Function: `apps/backend-rs/railway-functions/process-workflow-jobs.ts`
- Setup script (dry-run by default): `./scripts/workflow-queue-scheduler.sh`

Additional production schedulers:

- Anomaly scan (every 10 minutes):
  - `POST /v1/reports/anomalies/scan?org_id=<ORG_ID>`
  - Header: `Authorization: Bearer <operator-token>`
- Notifications retention (daily):
  - `POST /v1/internal/notifications-retention`
  - Header: `x-api-key: <INTERNAL_API_KEY>`
- Optional agent playbook runner:
  - `POST /v1/internal/agent-playbooks/run`
  - Header: `x-api-key: <INTERNAL_API_KEY>`

## Agent Route Smoke Check
Run this after migrations and backend deploy on staging/production.

Command:

```bash
BASE_URL="https://<backend-domain>/v1" \
ORG_ID="<org-uuid>" \
TOKEN="<operator-jwt>" \
CHAT_ID="<chat-uuid>" \
./scripts/agent-route-smoke.sh
```

Expected checkpoints:
- `GET /agent/chats`
- `GET /agent/approvals`
- `GET /agent/approval-policies`
- `GET /agent/inbox`
- `POST /agent/chats/{chat_id}/messages/stream`

CI guidance:
- Use a temporary smoke user (operator role), create one chat, run `./scripts/agent-route-smoke.sh`, then delete the user.
- Block promotion if the script exits non-zero.

## Observability Queries
Queue lag (oldest queued job):

```sql
select now() - min(run_at) as queue_lag
from workflow_jobs
where status = 'queued';
```

Failure rate by action type (24h):

```sql
select action_type,
       count(*) filter (where status = 'failed') as failed,
       count(*) as total,
       round((count(*) filter (where status = 'failed')::numeric / nullif(count(*), 0)) * 100, 2) as failed_pct
from workflow_jobs
where created_at >= now() - interval '24 hours'
group by action_type
order by failed desc;
```

Skipped rate by action type (24h):

```sql
select action_type,
       count(*) filter (where status = 'skipped') as skipped,
       count(*) as total,
       round((count(*) filter (where status = 'skipped')::numeric / nullif(count(*), 0)) * 100, 2) as skipped_pct
from workflow_jobs
where created_at >= now() - interval '24 hours'
group by action_type
order by skipped desc;
```

Retry exhaustion (terminal failed jobs):

```sql
select count(*) as exhausted
from workflow_jobs
where status = 'failed'
  and attempts >= max_attempts;
```

## Rollback
Rollback sequence:
1. Set `AI_AGENT_ENABLED=false` to disable agent execution paths.
2. Set `WORKFLOW_ENGINE_MODE=legacy` and redeploy backend.
3. Redeploy a known-good backend deployment from Railway (as of February 20, 2026: `eae79acf-b675-41ed-89fa-817399a23fbc`; prior checkpoint: `3836b968-9135-4874-95aa-ed7e4fc292db`).
4. Keep queue processor cron disabled while in legacy mode.

Schema rollback is not required for the additive agent migrations in this phase.
