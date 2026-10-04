#!/usr/bin/env node
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { systemCtx } from "./ctx.js";
import { createDaemon } from "./daemon.js";
import { exec } from "./process/exec.js";
import { serviceKind } from "./system/info.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const daemon = await createDaemon({
  // DONEPM_HOME relocates config and data, e.g. for a second instance during development.
  home: process.env.DONEPM_HOME ?? homedir(),
  exec,
  ctx: systemCtx,
  version,
  logger: true,
  // Under launchd a restart is an exit with an error code: `KeepAlive: {SuccessfulExit: false}` starts it again.
  ...(serviceKind(process.env) === "launchd"
    ? { service: { logFile: join(homedir(), "Library", "Logs", "donepm", "daemon.log"), restart: () => void shutdown("restart", 75) } }
    : {}),
  // The Vite dev server (pnpm dev) proxies to us from another origin.
  ...(process.env.DONEPM_DEV_ORIGIN ? { extraOrigins: [process.env.DONEPM_DEV_ORIGIN] } : {}),
});

let stopping = false;
async function shutdown(signal: string, code = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  daemon.app.log.info({ signal }, "shutting down");
  await daemon.stop();
  process.exit(code);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// A stray rejection in one subsystem (a poll, a setup step) must not take running agents down.
process.on("unhandledRejection", (err) => daemon.app.log.error({ err }, "unhandled rejection"));

try {
  await daemon.start();
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
  const { port } = err as { port?: number };
  console.error(`donePM: port ${port} is already in use. Is another donePM running? Stop it, or set "port" in the config.`);
  process.exit(1);
}
