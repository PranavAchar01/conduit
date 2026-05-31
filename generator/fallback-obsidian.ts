// ─────────────────────────────────────────────────────────────────────────────
// BUNDLED FALLBACK OBSIDIAN CONNECTOR
// This is a known-good, hand-written version of exactly what the generator is
// expected to produce. If ANTHROPIC_API_KEY is missing or the live call fails,
// the generator copies this into connectors/obsidian/index.ts so the golden
// path still runs end-to-end (the "cached known-good fallback" from the plan).
//
// It is intentionally written to the SAME shape the generator emits, including
// reading the vault path from process.env (NEVER hardcoded).
// ─────────────────────────────────────────────────────────────────────────────
export const FALLBACK_OBSIDIAN_CONNECTOR = String.raw`import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve, relative, extname } from "node:path";

const VAULT = process.env.OBSIDIAN_VAULT_PATH;

function requireVault(): string {
  if (!VAULT) throw new Error("OBSIDIAN_VAULT_PATH is not set");
  return VAULT;
}

// Resolve a user-supplied note path and refuse anything escaping the vault.
function safePath(vault: string, p: string): string {
  const abs = resolve(vault, p);
  const rel = relative(vault, abs);
  if (rel.startsWith("..") || resolve(vault, rel) !== abs) {
    throw new Error("path escapes the vault");
  }
  return abs;
}

async function listMarkdown(dir: string, vault: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await listMarkdown(full, vault, out);
    else if (extname(entry.name) === ".md") out.push(relative(vault, full));
  }
}

const TOOLS: Tool[] = [
  {
    name: "list_notes",
    description: "List all markdown note paths in the vault (relative to the vault root).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_note",
    description: "Read the contents of a note by its vault-relative path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Vault-relative .md path" } },
      required: ["path"],
    },
  },
  {
    name: "write_note",
    description: "Create or overwrite a note at a vault-relative path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Vault-relative .md path" },
        content: { type: "string", description: "Full markdown content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "search_notes",
    description: "Case-insensitive substring search across all notes; returns matching paths.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Text to search for" } },
      required: ["query"],
    },
  },
];

async function handleCall(name: string, args: Record<string, unknown>) {
  const vault = requireVault();
  switch (name) {
    case "list_notes": {
      const out: string[] = [];
      await listMarkdown(vault, vault, out);
      return { content: [{ type: "text" as const, text: out.join("\n") || "(vault is empty)" }] };
    }
    case "read_note": {
      const p = String(args.path ?? "");
      if (!p) return { content: [{ type: "text" as const, text: "path is required" }], isError: true };
      const text = await readFile(safePath(vault, p), "utf8");
      return { content: [{ type: "text" as const, text }] };
    }
    case "write_note": {
      const p = String(args.path ?? "");
      const content = String(args.content ?? "");
      if (!p) return { content: [{ type: "text" as const, text: "path is required" }], isError: true };
      await writeFile(safePath(vault, p), content, "utf8");
      return { content: [{ type: "text" as const, text: "wrote " + p }] };
    }
    case "search_notes": {
      const q = String(args.query ?? "").toLowerCase();
      if (!q) return { content: [{ type: "text" as const, text: "query is required" }], isError: true };
      const all: string[] = [];
      await listMarkdown(vault, vault, all);
      const hits: string[] = [];
      for (const rel of all) {
        const body = await readFile(join(vault, rel), "utf8");
        if (body.toLowerCase().includes(q)) hits.push(rel);
      }
      return { content: [{ type: "text" as const, text: hits.join("\n") || "(no matches)" }] };
    }
    default:
      return { content: [{ type: "text" as const, text: "Unknown tool: " + name }], isError: true };
  }
}

const server = new Server(
  { name: "obsidian", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    return await handleCall(req.params.name, args);
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: "Error in " + req.params.name + ": " + (err as Error).message }],
      isError: true,
    };
  }
});
await server.connect(new StdioServerTransport());
`;
