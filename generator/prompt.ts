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

HARD RULES — every violation is a failure:
- Output ONLY the complete .ts file. Zero prose, zero markdown fences, zero comments about the rules.
- Implement every tool listed in the service description — do not skip any.
- NEVER hardcode secrets, API keys, tokens, or paths — always read from process.env.
- Validate required arguments; return { content: [{ type: "text", text: "..." }], isError: true } for bad input.
- ALLOWED imports: node:fs/promises, node:path, node:crypto, @modelcontextprotocol/sdk. NO other packages.
- For HTTP APIs: use global fetch() — it is built into Node 18+ and needs NO import.
- fetch() auth pattern: always set headers in every request — credentials never come from cookies/session.
- Replace GENERATED_CONNECTOR_NAME with the server name specified in the service description.
- When returning structured data (lists, objects), format as readable text or JSON.stringify(value, null, 2).
- Never throw raw errors to the transport — always catch and return isError content.`;
}
