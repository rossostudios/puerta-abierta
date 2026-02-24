import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerResources } from "./resources.js";
import { fetchAndRegisterTools } from "./tools.js";

async function main() {
  const server = new McpServer({
    name: "casaora",
    version: "0.1.0",
  });

  // Register MCP resources (org snapshot, knowledge search)
  registerResources(server);

  // Fetch backend tool definitions and register as MCP tools
  const toolCount = await fetchAndRegisterTools(server);
  console.error(`[casaora-mcp] Registered ${toolCount} tools from backend`);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[casaora-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[casaora-mcp] Fatal error:", err);
  process.exit(1);
});
