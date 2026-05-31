// ─────────────────────────────────────────────────────────────────────────────
// CONDUIT GATEWAY — STDIO ENTRY (local / Claude Desktop)
// One MCP Server over stdio + the dashboard on DASHBOARD_PORT. For the hosted
// HTTP deployment (Render), see gateway/http.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGatewayServer, bootstrapConnectors, notifyAllToolsChanged, manager, dash } from "./core.ts";

async function main(): Promise<void> {
  dash.start(Number(process.env.DASHBOARD_PORT ?? 4317));
  await bootstrapConnectors();

  const server = createGatewayServer();
  await server.connect(new StdioServerTransport());
  await notifyAllToolsChanged();
  console.error("[gateway] Conduit is up on stdio. Connect an MCP client.");
}

process.on("SIGINT", async () => {
  await manager.closeAll();
  process.exit(0);
});

main().catch((err) => {
  console.error("[gateway] fatal:", err);
  process.exit(1);
});
