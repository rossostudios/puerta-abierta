# Casaora — Claude Code Ground Truth

> This file is the single source of truth for AI-assisted development.
> Every section is verified against the codebase. When in doubt, trust this file.

---

## 1. Project Identity

| Key | Value |
|-----|-------|
| Product | Casaora — AI-powered property management platform |
| Monorepo | Turborepo: `apps/admin` (Next.js 16), `apps/web`, `apps/backend-rs` (Rust/Axum) |
| Package manager | **npm** (`package-lock.json` at root — never use yarn/pnpm/bun) |
| Auth | Clerk (custom domain: `clerk.casaora.co`) |
| Database | AWS RDS PostgreSQL Multi-AZ with pgvector, RLS via `is_org_member()` |
| Storage | AWS S3 (public media + private documents buckets) |
| Infra | AWS ECS Fargate, Cloudflare DNS/WAF/CDN, Terraform IaC |
| Currency | PYG (Paraguayan Guaraní) — always integer, no decimals |
| Tax | 10% IVA (Paraguay) on all financial calculations |
| Icons | `@hugeicons/core-free-icons` (ESM — verify exports before using) |

**Domains:**
- `api.casaora.co` → backend (ALB)
- `app.casaora.co` → admin (ALB)
- `casaora.co` / `www.casaora.co` → web (ALB)

---

## 2. Critical Rules

**NEVER do these:**
- Reference Supabase, Vercel, Railway, or Portless — fully migrated to AWS/Cloudflare (Feb 2026)
- Use any DB env var other than `DATABASE_URL` — no fallbacks, no aliases
- Use wrapper functions for auth — use `AuthenticatedUser` struct directly from `auth.rs`
- Assume icon exports exist — `HeartbeatIcon`, `Target02Icon` don't exist in hugeicons free
- Use `yarn`, `pnpm`, or `bun` — this project uses `npm`
- Write `.pem`, `.key`, `.p12`, `credentials.json`, or `terraform.tfstate` files

**ALWAYS do these:**
- Use `db_error()` helper for database error mapping (defined in `ai_agent.rs`, `agent_chats.rs`)
- Include `org_id` in all multi-tenant queries — RLS enforces this
- Format currency as PYG integers (no decimal places)
- Run `./scripts/quality-gate.sh fast` before pushing

---

## 3. Architecture Quick Reference

| File | Lines | Purpose |
|------|-------|---------|
| `apps/backend-rs/src/auth.rs` | 372 | Clerk JWT validation, JWKS caching, user resolution |
| `apps/backend-rs/src/tenancy.rs` | 229 | Org membership, role checks, multi-tenancy |
| `apps/backend-rs/src/services/ai_agent.rs` | 7,593 | AI agent orchestration, 77 tool definitions + dispatch |
| `apps/backend-rs/src/middleware/security.rs` | 148 | Security headers (CSP, HSTS, X-Frame-Options) |
| `apps/backend-rs/src/config.rs` | 425 | 65+ env vars, all service configuration |
| `apps/backend-rs/src/main.rs` | 143 | Server bootstrap, middleware stack, graceful shutdown |
| `db/schema.sql` | 2,543 | Complete schema: 61 tables, 24 enums, indexes, RLS |

**Backend service modules** (47 in `apps/backend-rs/src/services/`):
AI: `ai_agent.rs`, `agent_runtime_v2.rs`, `agent_runtime_rollout.rs`, `agent_specs.rs`, `agent_chats.rs`, `ai_guest_reply.rs`, `llm_client.rs`, `tool_validator.rs`, `embeddings.rs`, `anomaly_detection.rs`, `ml_pipeline.rs`, `vision_ai.rs`
Financial: `payments.rs`, `mercado_pago.rs`, `reconciliation.rs`, `collection_cycle.rs`, `pricing.rs`, `dynamic_pricing.rs`, `expense_categorization.rs`, `portfolio.rs`, `scenario_simulation.rs`
Operations: `maintenance_dispatch.rs`, `leasing_agent.rs`, `tenant_screening.rs`, `background_check.rs`, `messaging.rs`, `sequences.rs`, `notification_center.rs`, `workflows.rs`, `iot.rs`, `metering.rs`
Data: `bank_feed.rs`, `airbnb.rs`, `lease_abstraction.rs`, `lease_schedule.rs`, `lease_renewal.rs`, `voice_agent.rs`, `analytics.rs`, `enrichment.rs`, `audit.rs`, `alerting.rs`
Infra: `scheduler.rs`, `cron.rs`, `storage.rs`, `ical.rs`, `fx.rs`, `token_hash.rs`, `plan_limits.rs`, `readiness.rs`

---

## 4. Database Schema Reference

**61 tables, 24 enums** — see `db/schema.sql` for full definitions.

### Tables by Domain

**Core (6):** `app_users`, `organizations`, `organization_members`, `organization_invites`, `platform_admins`, `org_subscriptions`

**Property (8):** `properties`, `units`, `property_floors`, `unit_spaces`, `unit_beds`, `unit_condition_events`, `integrations`, `integration_events`

**Leasing (6):** `application_submissions`, `application_events`, `leases`, `lease_charges`, `collection_records`, `contract_templates`

**Financial (10):** `owner_statements`, `expenses`, `payments`, `payment_instructions`, `pricing_templates`, `pricing_template_lines`, `listings`, `listing_fee_lines`, `subscription_plans`, `cancellation_policies`

**Operations (4):** `reservations`, `calendar_blocks`, `tasks`, `task_items`

**Maintenance (1):** `maintenance_requests`

**Messaging (5):** `message_templates`, `message_logs`, `communication_sequences`, `sequence_steps`, `sequence_enrollments`

**AI (10):** `ai_agents`, `ai_chats`, `ai_chat_messages`, `agent_runtime_overrides`, `agent_runtime_rollouts`, `agent_runtime_parity_runs`, `agent_traces`, `agent_approvals`, `agent_approval_policies`, `anomaly_alerts`

**Knowledge (2):** `knowledge_documents`, `knowledge_chunks`

**Access (2):** `tenant_access_tokens`, `owner_access_tokens`

**Notifications (4):** `notification_rules`, `notification_events`, `user_notifications`, `notification_rule_dispatches`

**Workflows (4):** `workflow_rules`, `workflow_jobs`, `workflow_job_attempts`, `workflow_round_robin_state`

**Audit (2):** `audit_logs`, `documents`

### Key Enums
- `member_role`: owner_admin, operator, cleaner, accountant, viewer
- `reservation_status`: pending, confirmed, checked_in, checked_out, cancelled, no_show
- `application_status`: new, screening, qualified, visit_scheduled, offer_sent, contract_signed, rejected, lost
- `lease_status`: draft, active, delinquent, terminated, completed
- `maintenance_status`: submitted, acknowledged, scheduled, in_progress, completed, closed
- `maintenance_urgency`: low, medium, high, emergency
- `collection_status`: scheduled, pending, paid, late, waived
- `statement_status`: draft, finalized, sent, paid
- `message_channel`: whatsapp, email, sms
- `priority_level`: low, medium, high, urgent
- `expense_category`: cleaning, maintenance, utilities, supplies, platform_fee, tax, staff, other

---

## 5. API Route Map

**47 route modules** in `apps/backend-rs/src/routes/`, all nested under `/v1`:

**AI & Agent:** `ai_agent.rs`, `agent_chats.rs`, `agent_inbox.rs`, `agent_management.rs`, `agent_playbooks.rs`, `agent_tools.rs`, `approvals.rs`, `voice_agent.rs`
**Property & Units:** `properties.rs`, `calendar.rs`, `booking.rs`, `public_ical.rs`, `marketplace.rs`
**Leasing:** `applications.rs`, `leases.rs`, `collections.rs`, `deposits.rs`, `contract_templates.rs`
**Financial:** `owner_statements.rs`, `expenses.rs`, `payments.rs`, `pricing.rs`, `reports.rs`, `subscriptions.rs`
**Operations:** `reservations.rs`, `tasks.rs`, `maintenance.rs`, `guests.rs`, `reviews.rs`
**Messaging:** `messaging.rs`, `sequences.rs`, `notifications.rs`, `notification_center.rs`
**Platform:** `organizations.rs`, `identity.rs`, `platform.rs`, `referrals.rs`, `guest_portal.rs`, `owner_portal.rs`, `tenant.rs`, `vendor_portal.rs`
**Infrastructure:** `health.rs`, `storage.rs`, `documents.rs`, `integrations.rs`, `workflows.rs`, `demo.rs`, `cancellation_policies.rs`

---

## 6. AI Agent Tool Catalog

**77 tools** defined in `ai_agent.rs`. Five agents with role-based access:

### Agent Access Matrix

| Agent | Slug | Tools | Key Rules |
|-------|------|-------|-----------|
| Operations Supervisor | `supervisor` | 18 (orchestration) | Classify → delegate. Block cross-org spend. |
| Guest Concierge | `guest-concierge` | All 77+ | Search knowledge first. Auto-store memories. Finance gate >$5K. |
| Leasing Agent | `leasing-agent` | 24 | Auto-advance score ≥70. Flag <40 for review. Income ≥3:1. |
| Maintenance Triage | `maintenance-triage` | 24 | SLA: Critical 4h, High 24h, Med 72h, Low 1w. Auto-escalate on breach. |
| Finance Agent | `finance-agent` | 38 | Include 10% IVA. Flag >5% variance. Reconcile to the penny. |

### Tools by Category

**Core Data (7):** `list_tables`, `get_org_snapshot`, `list_rows`, `get_row`, `create_row`, `update_row`, `delete_row`

**Intelligence (9):** `delegate_to_agent`, `get_occupancy_forecast`, `get_anomaly_alerts`, `get_today_ops_brief`, `get_lease_risk_summary`, `get_collections_risk`, `get_owner_statement_summary`, `search_knowledge`, `send_message`

**Maintenance (10):** `get_staff_availability`, `create_maintenance_task`, `classify_maintenance_request`, `auto_assign_maintenance`, `check_maintenance_sla`, `escalate_maintenance`, `request_vendor_quote`, `select_vendor`, `dispatch_to_vendor`, `verify_completion`

**Leasing (12):** `advance_application_stage`, `schedule_property_viewing`, `generate_lease_offer`, `send_application_update`, `match_applicant_to_units`, `auto_qualify_lead`, `send_tour_reminder`, `score_application`, `generate_pricing_recommendations`, `apply_pricing_recommendation`, `fetch_market_data`, `simulate_rate_impact`

**Financial (9):** `get_revenue_analytics`, `get_seasonal_demand`, `generate_owner_statement`, `reconcile_collections`, `categorize_expense`, `get_vendor_performance`, `auto_reconcile_all`, `import_bank_transactions`, `auto_reconcile_batch`

**Documents (7):** `abstract_lease_document`, `check_lease_compliance`, `check_document_expiry`, `check_paraguayan_compliance`, `track_lease_deadlines`, `auto_populate_lease_charges`, `get_regulatory_guidance`

**Portfolio (8):** `get_portfolio_kpis`, `get_property_comparison`, `simulate_investment_scenario`, `get_portfolio_trends`, `get_property_heatmap`, `generate_performance_digest`, `simulate_renovation_roi`, `simulate_stress_test`

**Voice (4):** `voice_lookup_caller`, `voice_create_maintenance_request`, `voice_check_reservation`, `log_voice_interaction`

**IoT & Access (5):** `generate_access_code`, `send_access_code`, `revoke_access_code`, `process_sensor_event`, `get_device_status`

**System (6):** `evaluate_agent_response`, `get_agent_health`, `execute_playbook`, `get_risk_radar`, `forecast_demand`, `classify_and_delegate`

**Memory (3):** `recall_memory`, `store_memory`, `summarize_conversation`

**Workflow (2):** `check_escalation_thresholds`, `create_execution_plan`

---

## 7. Coding Conventions

### Rust Tool Pattern (backend)
1. Define tool in `tool_definitions()` vec → JSON schema with name, description, parameters
2. Dispatch in `execute_tool()` match arm → route tool_name to implementation
3. Implement in service module → business logic with `db_error()` for DB errors

### Frontend Page Pattern (admin)
1. `page.tsx` — server component, fetches data via API
2. `*-manager.tsx` — client component, renders UI with state management
3. Components in `components/` subdirectory alongside the page

### Error Handling
- Rust: `AppError` enum with `Database`, `NotFound`, `Unauthorized`, `BadRequest` variants
- Use `db_error()` helper — never raw `.map_err()` for sqlx errors
- Pre-existing compile warnings in: `voice_agent.rs` (multipart), `bank_feed.rs`, `portfolio.rs` (AppError::Database)

### Naming
- Rust: snake_case files, PascalCase types, snake_case functions
- TypeScript: kebab-case files, PascalCase components, camelCase functions
- DB: snake_case tables and columns

---

## 8. Quality Gates

```bash
./scripts/quality-gate.sh          # Full: lint + typecheck + build (admin, web, backend)
./scripts/quality-gate.sh fast     # Skip admin build (faster iteration)
./scripts/quality-gate.sh backend  # Rust only: fmt + clippy + test
```

**CI Workflow:** `.github/workflows/` — GitHub Actions with AWS OIDC, ECR push, ECS deploy.

**Pre-push checklist:**
1. `./scripts/quality-gate.sh fast`
2. `cargo clippy --all-targets --all-features -- -D warnings`
3. Verify no new `@ts-ignore` or `any` types added

---

## 9. Domain Glossary

| Business Term | Code Entity | Table(s) |
|---------------|-------------|----------|
| Property | `Property` | `properties`, `units`, `property_floors` |
| Reservation | `Reservation` | `reservations`, `calendar_blocks` |
| Lease | `Lease` | `leases`, `lease_charges`, `collection_records` |
| Application | `ApplicationSubmission` | `application_submissions`, `application_events` |
| Owner Statement | `OwnerStatement` | `owner_statements`, `expenses`, `payments` |
| Maintenance Request | `MaintenanceRequest` | `maintenance_requests`, `tasks`, `task_items` |
| AI Agent | `AiAgent` | `ai_agents`, `ai_chats`, `ai_chat_messages` |
| Knowledge Base | `KnowledgeDocument` | `knowledge_documents`, `knowledge_chunks` |
| Agent Trace | `AgentTrace` | `agent_traces` |
| Approval | `AgentApproval` | `agent_approvals`, `agent_approval_policies` |
| Notification Rule | `NotificationRule` | `notification_rules`, `notification_events` |
| Workflow | `WorkflowRule` | `workflow_rules`, `workflow_jobs` |
| Collection | `CollectionRecord` | `collection_records` (rent payments within a lease) |
| Listing | `Listing` | `listings`, `listing_fee_lines`, `pricing_templates` |

---

## 10. MCP Server Usage Guide

Five MCP servers configured in `.mcp.json`:

| Server | When to Use | Common Tasks |
|--------|-------------|--------------|
| **sentry** | Error investigation, production monitoring | `search_issues`, `get_issue_details` — use when debugging prod errors |
| **mapbox** | Location/mapping features | Geocoding, distance calculations, map rendering |
| **casaora** | Live data queries against the running backend | Org snapshots, knowledge search, tool execution — use for testing AI tools |
| **clerk** | User/auth management | Create users, manage sessions, check auth state |
| **aws** | Infrastructure queries (read-only) | ECS task status, S3 bucket inspection, RDS metrics |

**Decision tree:**
- Need to understand code? → Read files directly (Glob/Grep/Read)
- Need live production data? → Use **casaora** MCP or **aws** MCP
- Need to debug a production error? → Use **sentry** MCP first
- Need user/auth info? → Use **clerk** MCP
- Need geo/location data? → Use **mapbox** MCP

---

## 11. Change Review Standards

### Tier 1 — Security-Sensitive
**Files:** `auth.rs`, `tenancy.rs`, `middleware/security.rs`, `db/migrations/*` (with RLS), `infra/terraform/`, `.github/workflows/`

**Protocol:**
- Explain security implications in your message BEFORE editing
- Read the entire file first — understand the full security context
- After editing, describe what changed and why it's safe
- Never weaken auth checks, RLS policies, or security headers without explicit approval

### Tier 2 — Infrastructure-Critical
**Files:** `ai_agent.rs`, `scheduler.rs`, `config.rs`, `main.rs`, `.mcp.json`, `Cargo.toml`, `package.json`

**Protocol:**
- Read entire file first — understand downstream dependencies
- State what other files/services are affected by your change
- For `ai_agent.rs`: changes affect all 5 AI agents and 77 tools
- For `config.rs`: changes may require env var updates in ECS task definitions

### Tier 3 — Standard
**Files:** Everything else (routes, services, components, pages)

**Protocol:**
- Normal workflow: implement → lint → test
- Run `./scripts/quality-gate.sh fast` after significant changes
- Follow existing patterns (see Section 7)
