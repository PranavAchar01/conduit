// ─────────────────────────────────────────────────────────────────────────────
// GENERATOR
// Turns a plain-English service description into a connector .ts file by calling
// the Anthropic Messages API. If no key is configured or the call fails, it uses
// the bundled known-good connector so the pipeline never dead-ends on stage.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { buildPrompt } from "./prompt.ts";
import { FALLBACK_OBSIDIAN_CONNECTOR } from "./fallback-obsidian.ts";

export interface GenerateResult {
  code: string;
  source: "anthropic" | "fallback";
  note?: string;
}

const API_URL = "https://api.anthropic.com/v1/messages";

/** Generate connector source for `serviceDescription`. Never throws. */
export async function generateConnector(serviceDescription: string): Promise<GenerateResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  const force = process.env.GENERATOR_FORCE_FALLBACK === "1";

  if (force || !key) {
    return {
      code: FALLBACK_OBSIDIAN_CONNECTOR,
      source: "fallback",
      note: force ? "forced fallback" : "ANTHROPIC_API_KEY not set",
    };
  }

  try {
    const prompt = await buildPrompt(serviceDescription);
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? [])
      .map((b) => (b.type === "text" ? b.text ?? "" : ""))
      .join("\n");
    const code = stripFences(text);
    if (!code.includes("StdioServerTransport")) {
      throw new Error("generated output does not look like an MCP server");
    }
    return { code, source: "anthropic" };
  } catch (err) {
    return {
      code: FALLBACK_OBSIDIAN_CONNECTOR,
      source: "fallback",
      note: `generation failed (${(err as Error).message}); used bundled connector`,
    };
  }
}

/** Write connector source to disk, returning the path. */
export async function writeConnectorFile(path: string, code: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, code, "utf8");
  return path;
}

/** Strip stray ```ts / ``` fences the model may emit despite the hard rule. */
function stripFences(text: string): string {
  const t = text.trim();
  const fence = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return (fence ? fence[1] : t).trim();
}
