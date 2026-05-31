// ─────────────────────────────────────────────────────────────────────────────
// HELLO-WORLD DOWNSTREAM SERVER (§11 first-30-minutes de-risk)
// The smallest possible connector. Confirm a client can call its tool through
// the gateway before building anything else.
//   npx @modelcontextprotocol/inspector tsx scripts/hello-downstream.ts
// ─────────────────────────────────────────────────────────────────────────────
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "hello", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ping",
      description: "Returns pong, optionally echoing a message.",
      inputSchema: { type: "object", properties: { message: { type: "string" } } },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const msg = (req.params.arguments?.message as string) ?? "";
  return { content: [{ type: "text", text: msg ? `pong: ${msg}` : "pong" }] };
});

await server.connect(new StdioServerTransport());
