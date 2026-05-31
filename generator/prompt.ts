// ─────────────────────────────────────────────────────────────────────────────
// GENERATION PROMPT (§7.4) — the second make-or-break piece.
// Gives the model the skeleton + hard rules so it only fills the body.
// ─────────────────────────────────────────────────────────────────────────────
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TEMPLATE_PATH = fileURLToPath(new URL("../templates/connector.ts", import.meta.url));

export async function buildPrompt(serviceDescription: string): Promise<string> {
  const skeleton = await readFile(TEMPLATE_PATH, "utf8");
  return `You are generating a complete Model Context Protocol (MCP) server in TypeScript.

TARGET SERVICE:
${serviceDescription}

USE EXACTLY THIS TEMPLATE/SKELETON (fill TOOLS[] and handleCall; keep all boilerplate):
${skeleton}

HARD RULES (violating any is a failure):
- Output ONLY the complete .ts file. No prose, no markdown fences.
- One tool per logical operation (e.g. list_notes, read_note, write_note, search_notes).
- NEVER hardcode secrets, paths, or tokens — read from process.env or tool args.
- Validate every input argument; return errors as structured tool content, never throw raw.
- Use only Node stdlib (node:fs/promises, node:path) + @modelcontextprotocol/sdk. No other deps.
- Each tool needs a clear name, description, and JSON Schema inputSchema.
- Replace GENERATED_CONNECTOR_NAME with a sensible server name.`;
}
