// ─────────────────────────────────────────────────────────────────────────────
// CONNECTOR SKELETON — fed verbatim to the generator (§7.3).
// A minimal, correct stdio MCP server with ONE ListTools + ONE CallTool handler.
// The generator fills in TOOLS[] and the per-tool logic in `handleCall`. The
// transport/handler structure must NOT change — that's what keeps generation
// from hallucinating the wrong shape.
// ─────────────────────────────────────────────────────────────────────────────
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// === GENERATOR FILLS THIS: one entry per logical operation ===
const TOOLS: Tool[] = [
  // {
  //   name: "example_op",
  //   description: "What it does, in one sentence.",
  //   inputSchema: {
  //     type: "object",
  //     properties: { path: { type: "string", description: "..." } },
  //     required: ["path"],
  //   },
  // },
];

// === GENERATOR FILLS THIS: the body for each tool ===
// Always return structured content; never throw raw to the transport.
async function handleCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  switch (name) {
    // case "example_op": { ... return { content: [{ type: "text", text: result }] }; }
    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

// === Boilerplate below — do not change ===
const server = new Server(
  { name: "GENERATED_CONNECTOR_NAME", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    return await handleCall(req.params.name, args);
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error in ${req.params.name}: ${(err as Error).message}` },
      ],
      isError: true,
    };
  }
});

await server.connect(new StdioServerTransport());
