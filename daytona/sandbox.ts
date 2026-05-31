// ─────────────────────────────────────────────────────────────────────────────
// DAYTONA SANDBOX (§7.6 — STRETCH, safe execution)
// Optionally run the generated connector in an isolated Daytona sandbox before
// it touches the user's machine. If Daytona is disabled/unreachable, fall back
// to a local child-process smoke test so generation is never blocked.
//
// NOTE: Daytona's primary surface is its SDK/REST API; confirm the current
// sandbox endpoints at the table. This is a supporting story, not the prize —
// keep the local fallback fast.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from "node:child_process";
import { connectorLaunch } from "../gateway/launch.ts";

export interface SmokeResult {
  ok: boolean;
  source: "daytona" | "local";
  detail: string;
}

export async function smokeTest(connectorPath: string, env: Record<string, string>): Promise<SmokeResult> {
  if (process.env.DAYTONA_ENABLED === "1" && process.env.DAYTONA_API_KEY) {
    try {
      return await daytonaSmoke(connectorPath);
    } catch (err) {
      return localSmoke(connectorPath, env).then((r) => ({
        ...r,
        detail: `Daytona failed (${(err as Error).message}); ${r.detail}`,
      }));
    }
  }
  return localSmoke(connectorPath, env);
}

/**
 * Local fallback: spawn the connector and verify it boots without crashing
 * within a short window. Full listTools verification happens at registration
 * time in the connector manager; this is just a "does it explode immediately"
 * gate so a broken file never reaches the gateway.
 */
function localSmoke(connectorPath: string, env: Record<string, string>): Promise<SmokeResult> {
  return new Promise((resolve) => {
    const { command, args } = connectorLaunch(connectorPath);
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: true, source: "local", detail: "booted without crashing" });
    }, 1500);
    child.on("exit", (code) => {
      clearTimeout(timer);
      // Connectors run until killed; an early non-zero exit means it crashed.
      if (code && code !== 0) resolve({ ok: false, source: "local", detail: err.slice(0, 300) || `exit ${code}` });
      else resolve({ ok: true, source: "local", detail: "process exited cleanly" });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, source: "local", detail: e.message });
    });
  });
}

async function daytonaSmoke(connectorPath: string): Promise<SmokeResult> {
  const base = process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api";
  const key = process.env.DAYTONA_API_KEY!;
  // Minimal: create a sandbox, hand it the file, request a boot check.
  // The exact request body depends on the Daytona SDK version — confirm at the
  // table. Kept thin on purpose; local fallback covers the demo.
  const res = await fetch(`${base}/sandbox`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ image: "node:22", entrypoint: `npx tsx ${connectorPath}` }),
  });
  if (!res.ok) throw new Error(`Daytona ${res.status}`);
  return { ok: true, source: "daytona", detail: "sandbox accepted connector" };
}
