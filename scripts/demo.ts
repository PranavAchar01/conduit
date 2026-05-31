// ─────────────────────────────────────────────────────────────────────────────
// DEMO RUNNER (rehearsal harness, §6 4:30 rehearsal / §8 demo script)
// Spins up an MCP client pointed at the gateway and runs the golden path
// headlessly, so you can prove the whole flow before doing it live:
//   1. list tools (federation alive)
//   2. ask the gateway to generate the Obsidian connector
//   3. confirm tool count ticked up (hot-load)
//   4. run the cross-connector workflow: read Obsidian → write summary to Tigris
//
// Usage: npm run demo
// ─────────────────────────────────────────────────────────────────────────────
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const GATEWAY = fileURLToPath(new URL("../gateway/index.ts", import.meta.url));

function names(tools: Array<{ name: string }>): string[] {
  return tools.map((t) => t.name);
}

async function main(): Promise<void> {
  const client = new Client({ name: "conduit-demo", version: "0.1.0" }, { capabilities: {} });
  await client.connect(new StdioClientTransport({ command: "tsx", args: [GATEWAY], env: { ...process.env } as Record<string, string> }));

  console.log("\n① Tools before generation:");
  const before = (await client.listTools()).tools;
  console.log("  " + names(before).join("\n  "));

  console.log("\n② Asking the gateway to build the Obsidian connector…");
  const gen = await client.callTool({
    name: "conduit__generate_connector",
    arguments: {
      name: "obsidian",
      service_description:
        "Obsidian vault of local markdown files at the path in env OBSIDIAN_VAULT_PATH. Tools: list_notes, read_note, write_note, search_notes.",
    },
  });
  console.log("  " + textOf(gen).split("\n").join("\n  "));

  console.log("\n③ Tools after generation (count should have ticked up):");
  const after = (await client.listTools()).tools;
  console.log("  " + names(after).join("\n  "));
  console.log(`  ${before.length} → ${after.length} tools`);

  // ④ Cross-connector workflow only if both connectors are live.
  const haveObsidian = after.some((t) => t.name.startsWith("obsidian__"));
  const haveTigris = after.some((t) => t.name.startsWith("tigris__"));
  if (haveObsidian && haveTigris && process.env.TIGRIS_BUCKET) {
    console.log("\n④ Cross-connector workflow: Obsidian → Tigris");
    const notes = await client.callTool({ name: "obsidian__list_notes", arguments: {} });
    const summary = `Conduit demo summary — ${new Date().toISOString()}\nNotes:\n${textOf(notes)}`;
    await client.callTool({
      name: "tigris__upload",
      arguments: { key: `conduit-summary-${Date.now()}.txt`, content: summary },
    });
    console.log("  uploaded summary to Tigris ✓");
  } else {
    console.log("\n④ Skipping cross-connector step (need obsidian + tigris + TIGRIS_BUCKET).");
  }

  await client.close();
  console.log("\nDone. Dashboard: http://localhost:" + (process.env.DASHBOARD_PORT ?? 4317) + "\n");
  process.exit(0);
}

function textOf(r: unknown): string {
  const content = (r as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("\n");
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});
