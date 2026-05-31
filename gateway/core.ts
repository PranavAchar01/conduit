// GATEWAY CORE — shared by stdio + HTTP entrypoints.
// ConnectorManager and Dashboard are singletons — one federation, one live tool
// set regardless of how many MCP sessions are connected.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { ConnectorManager } from "./connector-manager.ts";
import { Dashboard } from "./dashboard-server.ts";
import { runPipeline } from "./pipeline.ts";
import { connectorLaunch } from "./launch.ts";
import { listSavedConnectors, writeConnectorToDisk } from "./connector-store.ts";
import { findService, listServices } from "./catalog.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONNECTORS_DIR = `${ROOT}connectors/`;
export const DEFAULT_VAULT = `${ROOT}sample-vault`;

export const dash = new Dashboard();
export const manager = new ConnectorManager((e) => {
  if (e.type === "connector_added") dash.broadcast({ type: "connector_added", name: e.name, toolCount: e.toolCount });
  if (e.type === "connector_failed") dash.broadcast({ type: "connector_failed", name: e.name, error: e.error });
});

const activeServers = new Set<Server>();

export async function notifyAllToolsChanged(): Promise<void> {
  for (const s of activeServers) {
    try {
      await s.notification({ method: "notifications/tools/list_changed" });
    } catch {
      /* client may not support it */
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
    name: "conduit__list_services",
    description:
      "List all services Conduit knows how to connect to (Notion, GitHub, Slack, Linear, Airtable, Discord, Todoist, Jira, Obsidian). Shows required credentials for each.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "conduit__connect_service",
    description:
      "Connect a known service by its ID. Generates a connector live using Claude, security-scans it, smoke-tests it, and hot-loads the new tools — all without a restart. The connector is persisted to Tigris so it survives redeploys.",
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description: "Service ID from conduit__list_services (e.g. 'notion', 'github', 'slack', 'linear')",
        },
        config: {
          type: "object",
          description:
            "Credentials and config as key-value string pairs (e.g. { \"NOTION_API_KEY\": \"secret_...\" }). These become env vars for the connector process.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["service", "config"],
    },
  },
  {
    name: "conduit__generate_connector",
    description:
      "Generate, security-scan, smoke-test, and hot-load a new MCP connector for any service using a plain-English description. Use conduit__connect_service for known services — it produces better results.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short connector id / namespace, e.g. 'obsidian'" },
        service_description: {
          type: "string",
          description: "Plain-English description of the service and how to reach it",
        },
      },
      required: ["name", "service_description"],
    },
  },
];

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
      const names = manager.names();
      return {
        content: [{ type: "text", text: names.length ? names.join("\n") : "(none registered yet)" }],
      };
    }

    if (name === "conduit__list_services") {
      return { content: [{ type: "text", text: listServices() }] };
    }

    if (name === "conduit__connect_service") {
      const a = args as Record<string, unknown>;
      const serviceId = String(a.service ?? "").trim().toLowerCase();
      const config = (a.config ?? {}) as Record<string, string>;

      const entry = findService(serviceId);
      if (!entry) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown service "${serviceId}". Run conduit__list_services to see available options.`,
            },
          ],
          isError: true,
        };
      }

      if (manager.has(serviceId)) {
        const tools = (await manager.listTools()).filter((t) => t.name.startsWith(`${serviceId}__`));
        return {
          content: [
            {
              type: "text",
              text: `Connector "${serviceId}" is already registered with ${tools.length} tools:\n${tools.map((t) => `  ${t.name}`).join("\n")}`,
            },
          ],
        };
      }

      // Merge provided config + any matching vars already in the server env
      const env: Record<string, string> = {};
      for (const v of entry.envVars) {
        const val = config[v.key] ?? process.env[v.key];
        if (val) env[v.key] = val;
      }
      // Also pass through everything in config (caller may have included extra vars)
      Object.assign(env, config);
      // Special default: Obsidian uses the bundled sample vault when no path is supplied
      if (serviceId === "obsidian" && !env.OBSIDIAN_VAULT_PATH) {
        env.OBSIDIAN_VAULT_PATH = DEFAULT_VAULT;
      }

      const result = await runPipeline(
        { name: serviceId, serviceDescription: entry.prompt, env },
        manager,
        dash,
      );

      if (result.registered) {
        await notifyAllToolsChanged();
        const missing = entry.envVars
          .filter((v) => v.required && !env[v.key])
          .map((v) => v.key);
        const persistNote =
          Object.keys(config).length > 0
            ? `\n\nTo persist credentials across server restarts, add these to your server environment:\n${Object.keys(config)
                .map((k) => `  ${k}=<value>`)
                .join("\n")}`
            : "";
        const warnNote =
          missing.length > 0
            ? `\n\n⚠ Missing required env vars: ${missing.join(", ")} — connector may fail at runtime.`
            : "";
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) + persistNote + warnNote }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: true,
      };
    }

    if (name === "conduit__generate_connector") {
      const a = args as Record<string, unknown>;
      const connName = String(a.name ?? "").trim();
      const desc = String(a.service_description ?? "").trim();
      if (!connName || !desc) {
        return {
          content: [{ type: "text", text: "name and service_description are required" }],
          isError: true,
        };
      }
      if (manager.has(connName)) {
        return {
          content: [{ type: "text", text: `Connector "${connName}" is already registered.` }],
        };
      }
      const env: Record<string, string> = {};
      if (process.env.OBSIDIAN_VAULT_PATH) env.OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;
      else env.OBSIDIAN_VAULT_PATH = DEFAULT_VAULT;
      const result = await runPipeline({ name: connName, serviceDescription: desc, env }, manager, dash);
      if (result.registered) await notifyAllToolsChanged();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.registered,
      };
    }

    return manager.callTool(name, args as Record<string, unknown>);
  });

  activeServers.add(server);
  return server;
}

export function releaseServer(server: Server): void {
  activeServers.delete(server);
}

export async function bootstrapConnectors(): Promise<void> {
  // 1) Prebuilt Tigris connector
  try {
    await manager.add({ name: "tigris", ...connectorLaunch(`${CONNECTORS_DIR}tigris/index.ts`) });
  } catch (err) {
    console.error(`[gateway] tigris connector unavailable: ${(err as Error).message}`);
  }

  // 2) Restore generated connectors persisted in Tigris from previous runs
  const saved = await listSavedConnectors();
  if (saved.length > 0) {
    console.error(`[gateway] restoring ${saved.length} connector(s) from Tigris store`);
  }
  for (const { name, code } of saved) {
    if (manager.has(name)) continue;
    try {
      const path = await writeConnectorToDisk(CONNECTORS_DIR, name, code);
      await manager.add({ name, ...connectorLaunch(path) });
      console.error(`[gateway] restored "${name}" from store`);
    } catch (err) {
      console.error(`[gateway] failed to restore "${name}": ${(err as Error).message}`);
    }
  }

  dash.broadcast({ type: "tool_count", count: (await manager.listTools()).length });
}
