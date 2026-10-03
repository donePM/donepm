#!/usr/bin/env node
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { systemCtx } from "./ctx.js";
import { createDaemon } from "./daemon.js";
import { exec } from "./process/exec.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const daemon = await createDaemon({
  // DONEPM_HOME relocates config and data, e.g. for a second instance during development.
  home: process.env.DONEPM_HOME ?? homedir(),
  exec,
  ctx: systemCtx,
  version,
  logger: true,
  // The Vite dev server (pnpm dev) proxies to us from another origin.
  ...(process.env.DONEPM_DEV_ORIGIN ? { extraOrigins: [process.env.DONEPM_DEV_ORIGIN] } : {}),
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  daemon.app.log.info({ signal }, "shutting down");
  await daemon.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await daemon.start();
