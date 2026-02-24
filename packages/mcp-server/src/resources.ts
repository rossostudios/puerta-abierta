import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const API_BASE_URL = process.env.CASAORA_API_BASE_URL ?? "http://localhost:8000/v1";
const API_TOKEN = process.env.CASAORA_API_TOKEN ?? "";
const ORG_ID = process.env.CASAORA_ORG_ID ?? "";

async function backendGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return { error: `${res.status} ${res.statusText}` };
  }
  return res.json();
}

/** Register MCP resource providers for org snapshots and knowledge search. */
export function registerResources(server: McpServer): void {
  // Organization snapshot — provides high-level property/financial/occupancy data
  server.resource(
    "org-snapshot",
    `casaora://org/${ORG_ID}/snapshot`,
    async () => {
      const data = await backendGet(
        `/agent/execute-tool?org_id=${encodeURIComponent(ORG_ID)}`
      ).catch(() => null);

      // Use get_org_snapshot tool
      const res = await fetch(`${API_BASE_URL}/agent/execute-tool`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          org_id: ORG_ID,
          tool_name: "get_org_snapshot",
          args: {},
          allow_mutations: false,
        }),
      });

      const result = res.ok ? await res.json() : { error: "Failed to fetch snapshot" };

      return {
        contents: [
          {
            uri: `casaora://org/${ORG_ID}/snapshot`,
            text: JSON.stringify(result, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  );

  // Knowledge search — hybrid RAG search over the knowledge base
  server.resource(
    "knowledge-search",
    "casaora://org/{orgId}/knowledge/{query}",
    async (uri) => {
      // Extract query from URI path
      const parts = uri.pathname?.split("/") ?? uri.href.split("/");
      const query = decodeURIComponent(parts[parts.length - 1] ?? "");

      const res = await fetch(`${API_BASE_URL}/agent/execute-tool`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          org_id: ORG_ID,
          tool_name: "search_knowledge",
          args: { query, limit: 5 },
          allow_mutations: false,
        }),
      });

      const result = res.ok ? await res.json() : { error: "Knowledge search failed" };

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(result, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  );
}
