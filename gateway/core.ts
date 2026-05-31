// ─────────────────────────────────────────────────────────────────────────────
// GATEWAY CORE (shared by stdio + HTTP entrypoints)
// The ConnectorManager and Dashboard are singletons — there is ONE federation
// and ONE live tool set regardless of how many MCP sessions connect. Each MCP
// session gets its own lightweight Server (the SDK ties one Server to one
// transport), but every Server's handlers close over the same singletons, and
// tools/list_changed is broadcast to all active session Servers.
// ─────────────────────────────────────────────────────────────────────────────
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { ConnectorManager } from "./connector-manager.ts";
import { Dashboard } from "./dashboard-server.ts";
import { runPipeline } from "./pipeline.ts";
import { connectorLaunch } from "./launch.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONNECTORS_DIR = `${ROOT}connectors/`;
/** Bundled vault so the Obsidian golden path works on a cloud box with no local files. */
export const DEFAULT_VAULT = `${ROOT}sample-vault`;

export const dash = new Dashboard();
export const manager = new ConnectorManager((e) => {
  if (e.type === "connector_added") dash.broadcast({ type: "connector_added", name: e.name, toolCount: e.toolCount });
  if (e.type === "connector_failed") dash.broadcast({ type: "connector_failed", name: e.name, error: e.error });
});

/** All currently-connected session Servers (for broadcasting notifications). */
const activeServers = new Set<Server>();

export async function notifyAllToolsChanged(): Promise<void> {
  for (const s of activeServers) {
    try {
      await s.notification({ method: "notifications/tools/list_changed" });
    } catch {
      /* client may not support it; the demo client also force-refetches */
    }
  }
}

const META_TOOLS: Tool[] = [
  {
    name: "conduit__list_connectors",
    description: "List the connectors currently federated by the gateway.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "conduit__generate_connector",
    description:
      "Generate, security-scan, smoke-test, and hot-load a new MCP connector for a service that has no connector yet. Returns once the new tools are live.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short connector id / namespace, e.g. 'obsidian'" },
        service_description: { type: "string", description: "Plain-English description of the service + how to reach it" },
      },
      required: ["name", "service_description"],
    },
  },
];

/** Build a fresh MCP Server bound to the shared singletons. Caller manages lifecycle. */
export function createGatewayServer(): Server {
  const server = new Server(
    { name: "conduit", version: "0.1.0" },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const downstream = await manager.listTools();
    return { tools: [...META_TOOLS, ...downstream] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    if (name === "conduit__list_connectors") {
      return { content: [{ type: "text", text: manager.names().join("\n") || "(none)" }] };
    }

    if (name === "conduit__generate_connector") {
      const a = args as Record<string, unknown>;
      const connName = String(a.name ?? "").trim();
      const desc = String(a.service_description ?? "").trim();
      if (!connName || !desc) {
        return { content: [{ type: "text", text: "name and service_description are required" }], isError: true };
      }
      const env = { OBSIDIAN_VAULT_PATH: process.env.OBSIDIAN_VAULT_PATH || DEFAULT_VAULT };
      const result = await runPipeline({ name: connName, serviceDescription: desc, env }, manager, dash);
      if (result.registered) await notifyAllToolsChanged();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.registered };
    }

    return manager.callTool(name, args as Record<string, unknown>);
  });

  activeServers.add(server);
  return server;
}

export function releaseServer(server: Server): void {
  activeServers.delete(server);
}

/** Register the prebuilt connectors that ship with the repo. */
export async function bootstrapConnectors(): Promise<void> {
  try {
    await manager.add({ name: "tigris", ...connectorLaunch(`${CONNECTORS_DIR}tigris/index.ts`) });
  } catch (err) {
    console.error(`[gateway] tigris connector unavailable: ${(err as Error).message}`);
    console.error("[gateway] (set Tigris creds in env to enable it; gateway still runs)");
  }
  dash.broadcast({ type: "tool_count", count: (await manager.listTools()).length });
}
