// ─────────────────────────────────────────────────────────────────────────────
// OPSERA SCAN (§7.5) — THE PRIZE WIRING
// Between "Claude emits code" and "register connector", scan the generated file.
// Primary path: Opsera hosted DevSecOps MCP (streamable-http, Bearer token),
// calling the `security-scan` tool. Fallback: a local heuristic scan so the
// pipeline ALWAYS surfaces a scan stage on stage, even with no network/token.
//
// ⚠ The exact Opsera tool name + argument schema must be confirmed at the Opsera
//   table (§3). Override via OPSERA_SCAN_TOOL and the buildArgs() shape below.
// ─────────────────────────────────────────────────────────────────────────────
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface ScanFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
}

export interface ScanResult {
  source: "opsera" | "local";
  pass: boolean;
  findings: ScanFinding[];
  raw?: string;
}

/** Run the security scan on connector source. Never throws. */
export async function scanCode(code: string, filename = "connector.ts"): Promise<ScanResult> {
  const url = process.env.OPSERA_MCP_URL;
  const token = process.env.OPSERA_API_TOKEN;
  if (url && token) {
    try {
      return await scanWithOpsera(url, token, code, filename);
    } catch (err) {
      // fall through to local scan, but record why
      const local = localScan(code);
      local.findings.unshift({
        severity: "info",
        message: `Opsera unreachable (${(err as Error).message}); ran local scan`,
      });
      return local;
    }
  }
  return localScan(code);
}

async function scanWithOpsera(
  url: string,
  token: string,
  code: string,
  filename: string,
): Promise<ScanResult> {
  const client = new Client({ name: "conduit-opsera", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  try {
    const toolName = process.env.OPSERA_SCAN_TOOL ?? "security-scan";
    // Arg shape is best-effort; confirm at the Opsera table and adjust here.
    const result = (await client.callTool({
      name: toolName,
      arguments: { filename, content: code, language: "typescript" },
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

    const raw = (result.content ?? [])
      .map((b) => (b.type === "text" ? b.text ?? "" : ""))
      .join("\n");
    const findings = parseOpseraFindings(raw);
    const pass = !result.isError && !findings.some((f) => f.severity === "critical" || f.severity === "high");
    return { source: "opsera", pass, findings, raw };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Best-effort parse of Opsera text output into findings. */
function parseOpseraFindings(raw: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/\b(critical|high|medium|low|info)\b[:\-\s]+(.*)/i);
    if (m) {
      findings.push({
        severity: m[1].toLowerCase() as ScanFinding["severity"],
        message: m[2].trim() || line.trim(),
      });
    }
  }
  return findings;
}

/**
 * Local heuristic scan — secrets/dangerous-call detection.
 * Mirrors the categories Opsera's security-scan covers (secrets detection,
 * dangerous exec) so the demo beat works even offline.
 */
export function localScan(code: string): ScanResult {
  const findings: ScanFinding[] = [];
  const rules: Array<{ re: RegExp; sev: ScanFinding["severity"]; msg: string }> = [
    { re: /sk-[A-Za-z0-9]{16,}/, sev: "critical", msg: "Hardcoded API key literal detected" },
    { re: /(AKIA|tid_|tsec_)[A-Za-z0-9]{8,}/, sev: "critical", msg: "Hardcoded cloud/storage credential detected" },
    { re: /(password|secret|token)\s*[:=]\s*["'][^"']{6,}["']/i, sev: "high", msg: "Hardcoded secret assignment" },
    { re: /\bchild_process\b|\bexecSync\b|\bexec\(/, sev: "high", msg: "Shell execution in generated code" },
    { re: /\beval\(/, sev: "high", msg: "Use of eval()" },
  ];
  for (const { re, sev, msg } of rules) if (re.test(code)) findings.push({ severity: sev, message: msg });
  const pass = !findings.some((f) => f.severity === "critical" || f.severity === "high");
  return { source: "local", pass, findings };
}

/** Build a short instruction to feed back to the generator for a one-shot fix. */
export function patchInstruction(findings: ScanFinding[]): string {
  const lines = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .map((f) => `- [${f.severity}] ${f.message}`)
    .join("\n");
  return `The previous connector failed a security scan with these findings:\n${lines}\nRegenerate the complete file fixing every finding. Same hard rules. Output ONLY the .ts file.`;
}
