**Casaora** is a solid, modern foundation for a short-term rental (STR) operations platform tailored to Paraguay (Spanish, PYG/USD, America/Asuncion timezone, local invoice/RUC metadata). It uses a performant, secure stack: **Rust/Axum + SQLx** backend with a clean OpenAPI contract, **Supabase/PostgreSQL** (multi-tenant with RLS), **Next.js** admin + public web, and an **Expo/React Native** mobile scaffold.  

The core modules from the repo (README, PRD, backend routers, schema coverage, recent commits) are already wired into the admin UI and API:

- Multi-tenant orgs + RBAC (owner_admin, operator, cleaner, accountant, viewer)
- Properties/units (with capacity, rates, active/inactive toggles)
- Channel/listing mgmt + iCal import/export
- Guests + reservation lifecycle (status transitions, overlap protection, calendar blocks)
- Tasks (cleaning, maintenance, check-in/out, checklists, assignees)
- Expenses (per reservation/unit/property, with FX snapshots)
- Owner statements (draft → finalized → sent → paid workflow, revenue/expense/net payout)
- Messaging templates + send logs (WhatsApp/email/SMS ready)
- Basic owner summary reports (occupancy, revenue, RevPAN, etc.)

Business logic is at “starter” level (strong data model + CRUD + basic flows), with good foundations for audit logs, webhooks, and idempotency. Recent work includes mobile auth/tasks UI and the **AI agent runtime** (approval-first inbox — agents propose actions, humans review/approve). This is explicitly part of the Phase 1 foundation (rebrand + AI agents + guest features).

That’s an excellent MVP base — especially for a Rust/Supabase-first approach that will scale well and keep costs low.

### What’s Missing for a “Full” AI Agentic Property Management SaaS

A complete AI-agentic PMS goes far beyond CRUD + basic automation. It becomes a system where specialized **autonomous agents** (comms, ops, finance, pricing, etc.) can reason, use tools (your DB/API, external services), execute multi-step workflows, learn from history, and operate 24/7 with human oversight only on high-stakes decisions. Think of it as “digital staff” that handles 70-80% of repetitive work.

#### 1. Core Property Management SaaS Features (Still Missing or Minimal)
These are table-stakes for any serious PMS (Buildium, AppFolio, TenantCloud, etc.) and especially for scaling beyond tiny STR portfolios.

- **Payment processing & reconciliation** — No in-app collections, deposits, owner disbursements, or automated bank/ACH integration (Stripe, Mercado Pago, local PY gateways). Statements exist but are manual.
- **Guest/tenant self-service portal** — No dedicated portal where guests can view their booking, upload docs, make payments, submit maintenance requests, or access smart-lock codes.
- **Vendor/contractor portal** — Cleaners/maintenance teams need their own mobile/web view to accept jobs, upload before/after photos, mark checklists complete.
- **Document management & e-sign** — Leases, NDAs, inspection reports, insurance docs (generate PDFs, store securely, e-sign via DocuSign/Hellosign).
- **Deeper OTA/channel integrations** — Move from read-only iCal to two-way API sync (Airbnb, Booking.com, Vrbo) with real-time availability/pricing updates.
- **Full mobile apps** — The Expo scaffold exists; needs production-ready flows for staff (tasks + photos + offline), owners (reports + payouts), and guests.
- **Advanced accounting & trust compliance** — General ledger, automated reconciliation, PY tax reporting (IVA, IRP), multi-currency payouts.
- **SaaS billing & subscription tiers for your platform itself** — You support multi-org, but no Stripe billing, usage-based pricing, feature gating, or trial/onboarding flows.
- **Digital inspections, photo evidence, and preventive maintenance schedules**.
- **Review & reputation management** (auto-request reviews, respond to OTA feedback).

#### 2. Agentic AI Capabilities (The Real Differentiator)
You already have the **approval-first runtime + inbox** — that’s a fantastic safety-first starting point (human-in-the-loop prevents costly mistakes). Phase 3 of your PRD even calls out “AI-assisted guest communication & task triage.” You’re ahead of most, but a *full* agentic system needs this expanded dramatically.

**Missing agentic layers** (prioritized):

| Priority | Agent / Capability | Why It Matters | How It Builds on What You Have |
|----------|---------------------|----------------|--------------------------------|
| High | **Guest Communication Agent** | 24/7 WhatsApp/email responses, pre-arrival info, issue handling, upsells | Uses your messaging templates + reservation/guest data + LLM tool-calling |
| High | **Task & Maintenance Agent** | Auto-triage requests, assign cleaners, schedule, escalate delays, predict issues | Extends your task model + calendar + approval inbox |
| High | **Dynamic Pricing Agent** (Phase 2 in PRD) | Competitor monitoring, demand forecasting, auto-update rates on channels | Uses reservation history + external market data |
| High | **Finance & Reporting Agent** | Auto-generate & send owner statements, flag anomalies, suggest optimizations | Builds directly on owner statements + expense tables |
| Medium | **Lead Qualification & Direct Booking Agent** | Handle website inquiries, qualify, create reservations | Integrates with your public web app |
| Medium | **Predictive Maintenance & Portfolio Agent** | Forecast repairs from history/weather, optimize portfolio occupancy | Needs IoT/smart-lock data later |
| Medium | **Multi-agent Orchestrator + Workflow Builder** | Supervisor agent delegates to specialists; no-code workflow UI for users | Your current runtime becomes the execution engine |
| Medium | **RAG Knowledge Base + Memory** | Agents remember past guest issues, property quirks, local regs | Critical for accurate Paraguay-specific behavior |
| Low | **Image/Virtual Tour Agent** | Analyze property photos for quality/staging, generate descriptions | Nice-to-have for listings |
| Low | **Smart Home / IoT Agent** | Auto-issue lock codes, monitor occupancy sensors | Future-proofing |

**Technical gaps for agentic depth**:
- Robust tool-calling + long-running agent memory (LangGraph, CrewAI, or custom Rust + Anthropic/OpenAI/Grok APIs).
- Agent dashboard (monitor running agents, intervention logs, performance metrics).
- Human-in-the-loop escalation paths beyond the current inbox.
- Evaluation & safety guardrails (especially for financial or access-related actions).
- Local LLM options or hybrid (for cost/privacy in Paraguay).

#### 3. Other Polish & Scale Items
- Advanced analytics UI + dashboards (not just API reports).
- Localization/compliance depth (PY-specific tax rules, data residency).
- Onboarding wizard, demo data, video tutorials.
- Marketing site with live demo (beyond login wall).
- Security audit, rate limiting, SOC2 readiness.

### Recommended Next Steps (Realistic Roadmap)
1. **Short-term (next 4–8 weeks)** — Finish Phase 1 polish (stronger auth/audit, background jobs for iCal + messaging). Ship payment integration (Stripe/Mercado Pago) and basic guest portal. Expand the approval inbox into a proper agent dashboard.
2. **Medium-term** — Build the Guest Comm + Task Triage agents (Phase 3). Add dynamic pricing. Release full staff mobile app.
3. **Agentic leap** — Introduce a no-code agent builder + multi-agent supervisor on top of your existing runtime. Start with RAG over your DB + docs.
4. **Monetization** — Add SaaS billing so you can charge property managers.

**Bottom line**: You already have one of the cleanest tech foundations I’ve seen for a new PMS (Rust + Supabase is a killer combo for reliability and low ops cost). With the agent runtime already prototyped, you’re 6–12 months from a genuinely differentiated **AI-agentic** product that can compete with (and beat on cost/latency) the big US players in the LATAM/STR niche.

You’re not missing “features” so much as you’re missing the **autonomous execution layer** on top of the excellent data model you’ve built. Keep shipping — the bones are extremely strong. If you want a detailed PRD diff, agent architecture diagram, or help prioritizing the first agent, just say the word. 🚀