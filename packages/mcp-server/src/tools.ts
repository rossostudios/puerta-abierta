import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const API_BASE_URL = process.env.CASAORA_API_BASE_URL ?? "http://localhost:8000/v1";
const API_TOKEN = process.env.CASAORA_API_TOKEN ?? "";
const ORG_ID = process.env.CASAORA_ORG_ID ?? "";

/** Tools that mutate data and should require confirmation. */
const MUTATION_TOOLS = new Set([
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
  "store_memory",
]);

type BackendToolDef = {
  name: string;
  description: string;
  parameters: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
  needsApproval?: boolean;
};

type ExecuteToolResult = {
  ok: boolean;
  result: unknown;
};

/** Convert a JSON Schema property type string to a Zod schema. */
function jsonTypeToZod(prop: { type?: string; description?: string; enum?: string[] }): z.ZodTypeAny {
  const desc = prop.description ?? "";

  if (prop.enum && prop.enum.length > 0) {
    const enumSchema = z.enum(prop.enum as [string, ...string[]]);
    return desc ? enumSchema.describe(desc) : enumSchema;
  }

  switch (prop.type) {
    case "integer":
    case "number": {
      const num = z.number();
      return desc ? num.describe(desc) : num;
    }
    case "boolean": {
      const bool = z.boolean();
      return desc ? bool.describe(desc) : bool;
    }
    case "array": {
      const arr = z.array(z.unknown());
      return desc ? arr.describe(desc) : arr;
    }
    case "object": {
      const obj = z.record(z.unknown());
      return desc ? obj.describe(desc) : obj;
    }
    default: {
      const str = z.string();
      return desc ? str.describe(desc) : str;
    }
  }
}

/** Build a Zod object schema from a JSON Schema properties map. */
function buildZodShape(
  properties: Record<string, { type?: string; description?: string; enum?: string[] }>,
  required: string[]
): Record<string, z.ZodTypeAny> {
  const requiredSet = new Set(required);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    const base = jsonTypeToZod(prop);
    shape[key] = requiredSet.has(key) ? base : base.optional();
  }

  return shape;
}

/** Execute a tool on the Rust backend. */
async function executeToolOnBackend(toolName: string, args: Record<string, unknown>): Promise<ExecuteToolResult> {
  const res = await fetch(`${API_BASE_URL}/agent/execute-tool`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      org_id: ORG_ID,
      tool_name: toolName,
      args,
      allow_mutations: true,
      confirm_write: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Tool execution failed");
    return { ok: false, result: text };
  }

  return (await res.json()) as ExecuteToolResult;
}

/** Fetch tool definitions from the backend and register each as an MCP tool. */
export async function fetchAndRegisterTools(server: McpServer): Promise<number> {
  const res = await fetch(
    `${API_BASE_URL}/agent/tool-definitions?org_id=${encodeURIComponent(ORG_ID)}`,
    {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    console.error(`Failed to fetch tool definitions: ${res.status} ${res.statusText}`);
    return 0;
  }

  const payload = (await res.json()) as { tools?: BackendToolDef[] };
  const tools = payload.tools ?? [];

  for (const tool of tools) {
    const properties = tool.parameters?.properties ?? {};
    const required = tool.parameters?.required ?? [];
    const shape = buildZodShape(properties, required);
    const isMutation = MUTATION_TOOLS.has(tool.name);

    const annotations: Record<string, unknown> = {};
    if (isMutation) {
      annotations.confirmation = true;
    }

    server.tool(
      tool.name,
      tool.description,
      shape,
      async (args) => {
        const result = await executeToolOnBackend(tool.name, args as Record<string, unknown>);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.result, null, 2),
            },
          ],
          isError: !result.ok,
        };
      }
    );
  }

  return tools.length;
}
