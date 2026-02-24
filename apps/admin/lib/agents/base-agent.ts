import { jsonSchema } from "ai";
import { executeToolOnBackend } from "./tool-client";
import type { AgentConfig, ToolDefinition } from "./types";

/** Default mutation tools that require user approval via needsApproval. */
const DEFAULT_MUTATION_TOOLS = [
  "create_row",
  "update_row",
  "delete_row",
  "send_message",
  "apply_pricing_recommendation",
  "advance_application_stage",
  "escalate_maintenance",
  "auto_assign_maintenance",
  "select_vendor",
  "abstract_lease_document",
  "send_tour_reminder",
  "fetch_market_data",
  "dispatch_to_vendor",
  "verify_completion",
  "create_defect_tickets",
  "import_bank_transactions",
  "auto_reconcile_batch",
  "handle_split_payment",
  "auto_populate_lease_charges",
  "generate_access_code",
  "send_access_code",
  "revoke_access_code",
  "execute_playbook",
];

/**
 * Build AI SDK 6 tools map from backend tool definitions.
 * Returns raw tool objects compatible with streamText({ tools }).
 */
export function buildToolsFromDefinitions(
  toolDefs: ToolDefinition[],
  config: AgentConfig,
  token: string,
  orgId: string,
  chatId?: string
): Record<string, unknown> {
  const tools: Record<string, unknown> = {};
  const mutationSet = new Set([
    ...DEFAULT_MUTATION_TOOLS,
    ...config.mutationTools,
  ]);

  for (const def of toolDefs) {
    // Skip tools not in allowedTools if the agent has a whitelist
    if (
      config.allowedTools?.length &&
      !config.allowedTools.includes(def.name)
    ) {
      continue;
    }

    // Ensure schema is always a valid JSON Schema object type.
    // Backend may return null/undefined parameters or missing "type" field.
    const raw = def.parameters ?? {};
    const schema = {
      ...raw,
      type: "object" as const,
      properties: (raw as Record<string, unknown>).properties ?? {},
    };

    // Build tool object directly — tool() is an identity function in AI SDK 6
    // so we construct the object manually to avoid TypeScript generics issues
    // with jsonSchema's inferred never type.
    tools[def.name] = {
      description: def.description,
      inputSchema: jsonSchema(schema as Parameters<typeof jsonSchema>[0]),
      execute: async (args: Record<string, unknown>) => {
        const response = await executeToolOnBackend(token, {
          org_id: orgId,
          tool_name: def.name,
          args,
          allow_mutations: true,
          confirm_write:
            mutationSet.has(def.name) || def.needsApproval === true,
          agent_slug: config.slug,
          chat_id: chatId,
        });
        return response.result;
      },
    };
  }

  return tools;
}

/**
 * Get the default system prompt for an agent, with org context injected.
 */
export function buildSystemPrompt(
  config: AgentConfig,
  orgId: string,
  role: string
): string {
  return `${config.systemPrompt}

Current org_id is ${orgId}. Current user role is ${role}. Never access data outside this organization. When a user asks to create/update/delete data, call the matching tool. If a write tool returns an error, explain why and propose a safe next action.`;
}
