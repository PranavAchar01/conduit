// How we spawn connector child processes. Using the absolute node binary with
// tsx's import hook avoids depending on `tsx` being on PATH — important on
// Render, where child processes inherit a minimal environment.
export function connectorLaunch(path: string): { command: string; args: string[] } {
  const override = process.env.CONDUIT_LAUNCH_CMD; // e.g. "tsx" for local override
  if (override) return { command: override, args: [path] };
  return { command: process.execPath, args: ["--import", "tsx", path] };
}
