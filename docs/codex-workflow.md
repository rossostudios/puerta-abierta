# Codex Workflow (MCP + Quality + Delivery)

Last updated: February 12, 2026

## Goal

Make every Codex session deterministic:
- research with up-to-date docs first,
- implement with synchronized backend/frontend/schema changes,
- ship only after full quality gates pass.

## 1) MCP Setup (Recommended)

### Exa MCP (ecosystem docs, standards, libraries)

Add this to your Codex MCP config:

```toml
[mcp_servers.exa]
command = "npx"
args = ["-y", "mcp-remote", "https://mcp.exa.ai/mcp?exaApiKey=YOUR_EXA_API_KEY"]
```

Reference:
- Exa MCP docs: [docs.exa.ai/reference/mcp-server](https://docs.exa.ai/reference/mcp-server)

### OpenAI Docs MCP (Codex/OpenAI product docs)

Use the official OpenAI docs MCP endpoint:

- [gitmcp.io/openai/openai](https://gitmcp.io/openai/openai)

If your Codex client requires a command-based MCP wrapper, use `mcp-remote` with the URL above.

References:
- OpenAI MCP guide: [platform.openai.com/docs/mcp](https://platform.openai.com/docs/mcp)
- OpenAI docs MCP server: [gitmcp.io/openai/openai](https://gitmcp.io/openai/openai)

## 2) Session Playbook

1. Clarify scope and acceptance criteria.
2. Pull latest docs (MCP first, web fallback).
3. Implement smallest complete slice end-to-end.
4. Run quality gate:

```bash
./scripts/quality-gate.sh
```

5. Validate production-critical flows manually:
   - Marketplace browse + listing detail + apply
   - Applications board + assignment/SLA actions
   - Lease conversion + collections + owner statement reconciliation

## 3) Prompt Pattern That Works Well

Use this when asking Codex for changes:

```text
Goal:
Constraints:
Definition of done:
Files/surfaces allowed:
Must-run checks:
Deployment target:
```

## 4) Definition of Done (Casaora)

1. No lint/type/build regressions in admin.
2. Backend tests pass for changed behavior.
3. Multi-tenant boundaries preserved (`organization_id` scoping).
4. API response shape and UI rendering stay consistent.
5. Migrations are documented/applied when schema changed.

## 5) Notes

- If Exa MCP is unavailable in-session, use official source websites and include links.
- Keep dates explicit in communications (`April 1, 2026`, not “next quarter”).
- Favor reusable UI primitives (`Badge`, `Combobox`, `Calendar`, `Collapsible`) over one-off controls.

