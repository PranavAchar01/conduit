// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE — the on-demand generation flow from §2.
//   "I need X" → generate → Opsera scan (+one-shot patch) → smoke → register → hot-load
// Every stage emits a dashboard event so the UI animates and the tool count ticks.
// ─────────────────────────────────────────────────────────────────────────────
import { fileURLToPath } from "node:url";
import { generateConnector, writeConnectorFile } from "../generator/index.ts";
import { buildPrompt } from "../generator/prompt.ts";
import { scanCode, patchInstruction, type ScanResult } from "../opsera/scan.ts";
import { smokeTest } from "../daytona/sandbox.ts";
import { connectorLaunch } from "./launch.ts";
import { saveConnector } from "./connector-store.ts";
import type { ConnectorManager } from "./connector-manager.ts";
import type { Dashboard } from "./dashboard-server.ts";

const CONNECTORS_DIR = fileURLToPath(new URL("../connectors/", import.meta.url));

export interface PipelineInput {
  /** Connector id / namespace, e.g. "obsidian". */
  name: string;
  /** Plain-English service description fed to the generator. */
  serviceDescription: string;
  /** Env overrides passed to the spawned connector (e.g. vault path). */
  env?: Record<string, string>;
}

export interface PipelineResult {
  name: string;
  registered: boolean;
  generationSource: "anthropic" | "fallback";
  scan: ScanResult;
  patched: boolean;
  toolCount?: number;
  error?: string;
}

export async function runPipeline(
  input: PipelineInput,
  manager: ConnectorManager,
  dash: Dashboard,
): Promise<PipelineResult> {
  const { name, serviceDescription } = input;
  const path = `${CONNECTORS_DIR}${name}/index.ts`;

  const stage = (s: string, status: "start" | "ok" | "warn" | "fail", detail?: string) =>
    dash.broadcast({ type: "pipeline", stage: s, status, detail });

  // 1) Generate
  stage("generate", "start", `writing a connector for ${name}`);
  let gen = await generateConnector(serviceDescription);
  stage("generate", "ok", gen.source === "anthropic" ? "Claude wrote the connector" : `fallback: ${gen.note}`);

  // 2) Opsera scan (the prize beat)
  stage("scan", "start", "Opsera scanning generated code");
  let scan = await scanCode(gen.code, `${name}/index.ts`);
  let patched = false;

  for (const f of scan.findings) dash.broadcast({ type: "log", text: `[${scan.source}:${f.severity}] ${f.message}` });

  // 3) One-shot patch loop if the scan failed and we can regenerate
  if (!scan.pass && gen.source === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    stage("scan", "warn", "findings present — asking the agent to patch");
    const fixPrompt = `${await buildPrompt(serviceDescription)}\n\n${patchInstruction(scan.findings)}`;
    const fixed = await generateConnector(fixPrompt);
    gen = fixed;
    patched = true;
    scan = await scanCode(gen.code, `${name}/index.ts`);
    for (const f of scan.findings) dash.broadcast({ type: "log", text: `[rescan:${f.severity}] ${f.message}` });
  }
  stage("scan", scan.pass ? "ok" : "fail", scan.pass ? "scan PASS" : "scan did not pass");

  if (!scan.pass) {
    return { name, registered: false, generationSource: gen.source, scan, patched, error: "scan failed" };
  }

  // 4) Write final source to disk
  await writeConnectorFile(path, gen.code);

  // 5) Smoke test (Daytona stretch, local fallback)
  stage("sandbox", "start", "smoke-testing the connector");
  const smoke = await smokeTest(path, input.env ?? {});
  stage("sandbox", smoke.ok ? "ok" : "fail", `${smoke.source}: ${smoke.detail}`);
  if (!smoke.ok) {
    return { name, registered: false, generationSource: gen.source, scan, patched, error: `smoke failed: ${smoke.detail}` };
  }

  // 6) Register into the gateway + hot-load
  stage("register", "start", "registering connector");
  try {
    const tools = await manager.add({ name, ...connectorLaunch(path), env: input.env });
    const total = (await manager.listTools()).length;
    stage("register", "ok", `${name} live with ${tools.length} tools`);
    dash.broadcast({ type: "tool_count", count: total });
    // 7) Persist to Tigris so the connector survives redeploy
    saveConnector(name, gen.code).catch((err) =>
      console.error(`[pipeline] store save failed: ${(err as Error).message}`),
    );
    return { name, registered: true, generationSource: gen.source, scan, patched, toolCount: total };
  } catch (err) {
    stage("register", "fail", (err as Error).message);
    return { name, registered: false, generationSource: gen.source, scan, patched, error: (err as Error).message };
  }
}
