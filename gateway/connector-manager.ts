// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR MANAGER
// Owns the map of downstream MCP clients. Spawns each connector as a child
// process, smoke-tests it (listTools), and exposes aggregate/route helpers.
// The gateway calls into this; the dashboard observes via the event callback.
// ─────────────────────────────────────────────────────────────────────────────
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ConnectorSpec {
  /** Short id; becomes the tool namespace, e.g. "tigris" -> "tigris__upload". */
  name: string;
  command: string;
  args: string[];
  /** Extra env merged over process.env for the child (e.g. vault path). */
  env?: Record<string, string>;
}

interface Entry {
  spec: ConnectorSpec;
  client: Client;
}

export type ManagerEvent =
  | { type: "connector_added"; name: string; toolCount: number }
  | { type: "connector_failed"; name: string; error: string };

const SEP = "__";

export class ConnectorManager {
  private entries = new Map<string, Entry>();
  constructor(private onEvent: (e: ManagerEvent) => void = () => {}) {}

  /** Spawn + connect + smoke-test a downstream connector. Throws on failure. */
  async add(spec: ConnectorSpec): Promise<Tool[]> {
    if (this.entries.has(spec.name)) {
      throw new Error(`Connector "${spec.name}" already registered`);
    }
    const client = new Client(
      { name: `conduit-${spec.name}`, version: "0.1.0" },
      { capabilities: {} },
    );

    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      // Child inherits our env plus any connector-specific overrides.
      env: { ...sanitizedEnv(), ...(spec.env ?? {}) },
      stderr: "inherit",
    });

    try {
      await client.connect(transport);
      // Smoke test: a connector that can't list its tools is dead on arrival.
      const { tools } = await client.listTools();
      this.entries.set(spec.name, { spec, client });
      this.onEvent({ type: "connector_added", name: spec.name, toolCount: tools.length });
      return tools;
    } catch (err) {
      const error = (err as Error).message;
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      this.onEvent({ type: "connector_failed", name: spec.name, error });
      throw new Error(`Failed to register "${spec.name}": ${error}`);
    }
  }

  /** Aggregate all downstream tools, namespaced by connector name. */
  async listTools(): Promise<Tool[]> {
    const all: Tool[] = [];
    for (const [name, { client }] of this.entries) {
      const { tools } = await client.listTools();
      for (const t of tools) all.push({ ...t, name: `${name}${SEP}${t.name}` });
    }
    return all;
  }

  /** Route a namespaced tool call to the owning connector. */
  async callTool(namespaced: string, args: Record<string, unknown>) {
    const idx = namespaced.indexOf(SEP);
    if (idx === -1) throw new Error(`Tool name missing namespace: ${namespaced}`);
    const name = namespaced.slice(0, idx);
    const tool = namespaced.slice(idx + SEP.length);
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unknown connector: ${name}`);
    return entry.client.callTool({ name: tool, arguments: args });
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async closeAll(): Promise<void> {
    for (const { client } of this.entries.values()) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
    this.entries.clear();
  }
}

/** Don't forward secrets a child connector has no business seeing. */
function sanitizedEnv(): Record<string, string> {
  const blocked = new Set(["ANTHROPIC_API_KEY", "OPSERA_API_TOKEN", "DAYTONA_API_KEY"]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !blocked.has(k)) out[k] = v;
  }
  return out;
}
