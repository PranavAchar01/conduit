// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD SIDECAR (§2 — separate from the MCP transport on purpose)
// Serves ui/ over HTTP and broadcasts pipeline events over WebSocket so the
// dashboard can animate stages and tick the live tool count. Keeping this off
// the stdio MCP channel means the demo UI can never corrupt the agent transport.
// ─────────────────────────────────────────────────────────────────────────────
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));

export type DashboardEvent =
  | { type: "connector_added"; name: string; toolCount: number }
  | { type: "connector_failed"; name: string; error: string }
  | { type: "tool_count"; count: number }
  | { type: "pipeline"; stage: string; status: "start" | "ok" | "warn" | "fail"; detail?: string }
  | { type: "log"; text: string };

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

export class Dashboard {
  private wss?: WebSocketServer;
  private clients = new Set<WebSocket>();
  /** Replayed to any client that connects late, so the demo UI is never empty. */
  private history: DashboardEvent[] = [];

  start(port: number): void {
    const http = createServer((req, res) => this.handleStatic(req, res));
    this.attach(http);
    http.listen(port, () => {
      console.error(`[dashboard] http://localhost:${port}`);
    });
  }

  /** Attach the WS sidecar to an already-created HTTP server (Render: shares $PORT). */
  attach(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ server: httpServer });
    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      for (const e of this.history) ws.send(JSON.stringify(e));
      ws.on("close", () => this.clients.delete(ws));
    });
  }

  broadcast(event: DashboardEvent): void {
    this.history.push(event);
    if (this.history.length > 500) this.history.shift();
    const msg = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  /** Serve a file from ui/. Public so the Render HTTP entry can route to it. */
  async handleStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? "/").split("?")[0];
    const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
    // Prevent path traversal out of UI_DIR.
    const target = normalize(join(UI_DIR, rel));
    if (!target.startsWith(UI_DIR)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(target);
      res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  }
}
