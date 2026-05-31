// ─────────────────────────────────────────────────────────────────────────────
// HTTP DEMO RUNNER — drives a DEPLOYED Conduit over Streamable HTTP.
//   CONDUIT_URL=https://conduit-xxxx.onrender.com/mcp \
//   CONDUIT_API_KEY=... \
//   npm run demo:http
// ─────────────────────────────────────────────────────────────────────────────
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_STR = process.env.CONDUIT_URL ?? "http://localhost:10000/mcp";
const KEY = process.env.CONDUIT_API_KEY;

function textOf(r: unknown): string {
  const content = (r as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("\n");
}

async function main(): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(URL_STR), {
    requestInit: KEY ? { headers: { Authorization: `Bearer ${KEY}` } } : undefined,
  });
  const client = new Client({ name: "conduit-demo-http", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  console.log(`\nConnected to ${URL_STR}`);
  console.log("\n① Tools before generation:");
  const before = (await client.listTools()).tools;
  console.log("  " + before.map((t) => t.name).join("\n  "));

  console.log("\n② Asking the gateway to build the Obsidian connector…");
  const gen = await client.callTool({
    name: "conduit__generate_connector",
    arguments: {
      name: "obsidian",
      service_description:
        "Obsidian vault of local markdown files at env OBSIDIAN_VAULT_PATH. Tools: list_notes, read_note, write_note, search_notes.",
    },
  });
  console.log("  " + textOf(gen).split("\n").join("\n  "));

  console.log("\n③ Tools after generation:");
  const after = (await client.listTools()).tools;
  console.log("  " + after.map((t) => t.name).join("\n  "));
  console.log(`  ${before.length} → ${after.length} tools`);

  if (after.some((t) => t.name.startsWith("obsidian__"))) {
    const notes = await client.callTool({ name: "obsidian__list_notes", arguments: {} });
    console.log("\n④ obsidian__list_notes:\n  " + textOf(notes).split("\n").join("\n  "));
  }

  await client.close();
  console.log("\nDone.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("demo:http failed:", err);
  process.exit(1);
});
