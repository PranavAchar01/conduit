// ─────────────────────────────────────────────────────────────────────────────
// CONDUIT GATEWAY — HTTP ENTRY (Render / any single-port host)
// Serves three things on ONE port ($PORT):
//   • POST/GET/DELETE /mcp  → MCP over Streamable HTTP (remote agents connect here)
//   • GET /healthz          → Render health check
//   • everything else       → the dashboard (static UI) + WebSocket sidecar
//
// Because this endpoint runs LLM-GENERATED CODE in the container, /mcp is gated
// by a bearer token when CONDUIT_API_KEY is set. Set it in production.
// ─────────────────────────────────────────────────────────────────────────────
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  createGatewayServer,
  releaseServer,
  bootstrapConnectors,
  notifyAllToolsChanged,
  manager,
  dash,
} from "./core.ts";

const PORT = Number(process.env.PORT ?? process.env.DASHBOARD_PORT ?? 4317);
const API_KEY = process.env.CONDUIT_API_KEY;
const ALLOWED_ORIGIN = process.env.CONDUIT_ALLOWED_ORIGIN ?? "*";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
}
const sessions = new Map<string, Session>();

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
}

function authorized(req: IncomingMessage): boolean {
  if (!API_KEY) return true; // open if unset (a warning is logged at boot)
  const h = req.headers["authorization"];
  return typeof h === "string" && h === `Bearer ${API_KEY}`;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 5_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch (e) {
        reject(e as Error);
      }
    });
    req.on("error", reject);
  });
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "POST") {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      res.writeHead(400).end("invalid JSON body");
      return;
    }

    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (existing) {
      await existing.transport.handleRequest(req, res, body);
      return;
    }

    // New session — must be an initialize request.
    if (!isInitializeRequest(body)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no session and not an initialize request" }));
      return;
    }

    const server = createGatewayServer();
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string): void => { sessions.set(sid, { transport, server }); },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
      releaseServer(server);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      res.writeHead(400).end("unknown or missing session");
      return;
    }
    await session.transport.handleRequest(req, res);
    return;
  }

  res.writeHead(405).end("method not allowed");
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error("[gateway] ⚠ CONDUIT_API_KEY is not set — /mcp is OPEN. Set it in production.");
  }

  const httpServer = createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    try {
      if (url === "/mcp" || url.startsWith("/mcp/")) return await handleMcp(req, res);
      if (url === "/healthz") {
        const count = (await manager.listTools()).length;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", tools: count, connectors: manager.names() }));
        return;
      }
      await dash.handleStatic(req, res);
    } catch (err) {
      res.writeHead(500).end((err as Error).message);
    }
  });

  dash.attach(httpServer); // WebSocket sidecar shares this server
  await bootstrapConnectors();

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.error(`[gateway] Conduit HTTP up on :${PORT}  (MCP: /mcp · dashboard: /)`);
  });

  // If any connectors were registered at boot, tell late-joining sessions.
  await notifyAllToolsChanged();
}

process.on("SIGINT", async () => {
  await manager.closeAll();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await manager.closeAll();
  process.exit(0);
});

main().catch((err) => {
  console.error("[gateway] fatal:", err);
  process.exit(1);
});
