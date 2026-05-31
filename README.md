# Conduit

A local MCP gateway your agent connects to **once**. It federates all your existing
connectors behind a single endpoint — and when it hits a service nobody built a
connector for, it **writes that connector itself**, gets **Opsera** to harden it,
and **hot-loads it live with no restart**.

```
AI client ──one MCP connection──▶ CONDUIT GATEWAY ──▶ tigris   (prebuilt)
                                        │         ──▶ obsidian (generated live)
                                        └ pipeline: generate → Opsera scan → smoke → register → hot-load
                                          + WS dashboard
```

## Quick start

```bash
npm install                 # installs @modelcontextprotocol/sdk, @aws-sdk/client-s3, ws, tsx
cp .env.example .env        # then fill in YOUR keys (see "Keys" below)

# 0. De-risk first (the §11 check): can a client call a downstream tool?
npx @modelcontextprotocol/inspector tsx scripts/hello-downstream.ts

# 1. Run the gateway (also serves the dashboard on :4317)
npm run gateway

# 2. In another terminal, run the full golden path headlessly for rehearsal
npm run demo
#    open http://localhost:4317 to watch the pipeline + tool count live
```

To connect Claude Desktop instead of the demo client, add to its MCP config:

```json
{
  "mcpServers": {
    "conduit": { "command": "tsx", "args": ["/abs/path/to/conduit/gateway/index.ts"] }
  }
}
```

## Deploy to Render (hosted HTTP)

Conduit runs in two modes from the same code:

- **stdio** (`npm run gateway`) — local, for Claude Desktop.
- **HTTP** (`npm run start` → `gateway/http.ts`) — for Render. Serves the MCP
  endpoint, the dashboard, and the WebSocket sidecar on one `$PORT`:
  - `POST/GET/DELETE /mcp` → MCP over **Streamable HTTP** (agents connect here)
  - `GET /healthz` → health check
  - `GET /` → the live dashboard

**Steps**

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. `render.yaml` provisions the web
   service (build `npm install`, start `npm run start`, health `/healthz`).
3. In the Render dashboard, set the secret env vars (everything marked
   `sync: false`). **Set `CONDUIT_API_KEY`** to a strong random value — `/mcp`
   runs generated code, so the public endpoint must be gated.
4. Deploy, then drive it remotely:

   ```bash
   CONDUIT_URL=https://<your-service>.onrender.com/mcp \
   CONDUIT_API_KEY=<the key you set> \
   npm run demo:http
   ```

   Dashboard: `https://<your-service>.onrender.com/`.

**Render-specific behavior**

- **No local Obsidian vault on a cloud box** → when `OBSIDIAN_VAULT_PATH` is unset
  the gateway uses the bundled `sample-vault/`, so the hero demo still works.
- **Ephemeral filesystem**: generated connectors are written + spawned inside the
  running container; lost on redeploy, regenerated on demand. Fine for this design.
- **Free plan spins down when idle** (slow first hit) — `render.yaml` uses
  `starter` for a steady live demo; switch to `free` to avoid cost.
- `tsx` is a runtime dependency; connectors are spawned via `node --import tsx`.

## What an agent does with it

The gateway exposes two meta-tools plus every federated tool:

- `conduit__list_connectors`
- `conduit__generate_connector` — give it `{ name, service_description }` and it
  runs generate → scan → smoke → register, then the new tools appear live.
- `tigris__upload`, `tigris__read`, `obsidian__read_note`, … (federated)

Demo closer (cross-connector workflow): *"Summarize my Obsidian daily notes and
save the summary to Tigris."* — `scripts/demo.ts` runs exactly this.

## Keys you must provide (in `.env`, never in chat)

| Key | Needed for | Where |
|---|---|---|
| `OBSIDIAN_VAULT_PATH` | the hero generation target | a local folder of `.md` files |
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`) | live connector generation | console.anthropic.com |
| `OPSERA_API_TOKEN` (+ `OPSERA_MCP_URL`, `OPSERA_SCAN_TOOL`) | the prize scan beat | Opsera Dashboard → API Keys |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `TIGRIS_BUCKET` | Tigris federation target | console.tigris.dev |
| `DAYTONA_API_KEY` (+ `DAYTONA_ENABLED=1`) | stretch: sandboxed execution | app.daytona.io |

**Built-in fallbacks so the demo never hard-fails:**
- No `ANTHROPIC_API_KEY` → generator uses the bundled known-good Obsidian
  connector (`generator/fallback-obsidian.ts`).
- No/unreachable Opsera → a local secrets/heuristic scan still lights up the
  scan stage.
- Daytona off/unreachable → local child-process smoke test.
- `tools/list_changed` ignored by a client → the demo client re-lists tools, so
  the new tool always shows up.

## ⚠ Confirm at the sponsor tables before the demo (per the plan §3, §7.5)

1. **Opsera** scan tool's **exact name + argument schema**. The code defaults to
   `security-scan` with `{ filename, content, language }`; adjust
   `OPSERA_SCAN_TOOL` and `scanWithOpsera()` in `opsera/scan.ts` to match.
2. **Daytona** current sandbox endpoint/body (`daytona/sandbox.ts` is thin on
   purpose; local fallback covers the demo if it drifts).
3. **Tigris** endpoint (`t3.storage.dev` vs `fly.storage.tigris.dev`) + a bucket.

## Layout

```
gateway/      core (shared singletons + server factory) · index.ts (stdio) · http.ts (Render)
              connector manager (downstream) · pipeline · dashboard sidecar · launch helper
connectors/   tigris/ (prebuilt) · obsidian/ (generated at runtime)
generator/    Anthropic call + prompt + bundled fallback connector
templates/    connector skeleton fed to the generator
opsera/       DevSecOps scan (hosted MCP) + local fallback + one-shot patch
daytona/      stretch sandbox + local smoke fallback
ui/           dashboard (plain HTML + WS, no build step)
sample-vault/ markdown notes so the Obsidian demo works on a cloud box
scripts/      hello-downstream (de-risk) · demo (stdio rehearsal) · demo-http (hits a deployment)
render.yaml   Render Blueprint
```

## Status / caveats

- **Built complete, not yet run.** It was authored in an offline environment, so
  dependencies were not installed and it has **not been type-checked or executed**
  here. Run `npm install` then `npm run typecheck` first.
- **SDK API drift:** pinned to `@modelcontextprotocol/sdk@^1.12` using the classic
  `Server`/`Client` + request-handler API, plus `StreamableHTTPServerTransport`
  (`/server/streamableHttp.js`) and `StreamableHTTPClientTransport`
  (`/client/streamableHttp.js`) for the hosted mode. If you install a V2-only
  build, import paths and `setRequestHandler`/transport constructors may need
  adjusting. The Streamable-HTTP session handling in `gateway/http.ts` follows the
  documented 1.x pattern — verify against your installed version after `npm install`.
- **Model string** (`ANTHROPIC_MODEL`) defaults to a placeholder — set it to the
  current model for your account.
