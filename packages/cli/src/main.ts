#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { exec } from "@donepm/daemon/exec";
import { daemonUrl, fetchStatus } from "./api.js";
import { open, status, stop, type LifecycleDeps } from "./lifecycle.js";
import { readSecret } from "./secret.js";
import { installService, servicePaths, uninstallService, type ServiceDeps } from "./service.js";
import { deleteToken, setToken, type TokenDeps } from "./token.js";

const USAGE = `Usage: donepm <command>

Commands:
  start              run the daemon in the foreground
  stop               stop the running daemon
  status             show whether the daemon runs, and its CLI checks
  open               open the board in the browser
  install-service    start donePM now and at every login (launchd)
  uninstall-service  remove the launchd job
  token set <id>     store the API token of a connection in the Keychain
                     (piped on stdin, or typed at a hidden prompt)
  token delete <id>  remove the API token of a connection

Options:
  -h, --help         show this help
  -v, --version      print the version

DONEPM_HOME relocates config and data (default: your home directory).`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } },
});

if (values.version) {
  const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
  console.log(version);
  process.exit(0);
}

const command = positionals[0];
if (values.help || !command) {
  console.log(USAGE);
  process.exit(command || values.help ? 0 : 2);
}

const home = process.env.DONEPM_HOME ?? homedir();
const url = await daemonUrl(home);
const deps: LifecycleDeps = {
  url,
  status: () => fetchStatus(url),
  exec,
  kill: (pid, signal) => process.kill(pid, signal),
  sleep: (ms) => sleep(ms),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};
// Homebrew sets both to its stable `opt` paths, so the launchd job survives `brew upgrade`.
const daemonEntry = process.env.DONEPM_DAEMON_ENTRY ?? fileURLToPath(import.meta.resolve("@donepm/daemon"));
const nodePath = process.env.DONEPM_NODE ?? process.execPath;

function serviceDeps(): ServiceDeps {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  if (process.env.DONEPM_HOME) env.DONEPM_HOME = process.env.DONEPM_HOME;
  const paths = servicePaths(homedir());
  return {
    ...deps,
    paths,
    plist: { node: nodePath, entry: daemonEntry, logDir: paths.logDir, workingDirectory: homedir(), env },
    uid: process.getuid?.() ?? 0,
  };
}

switch (command) {
  case "start": {
    const running = await deps.status();
    if (running) {
      deps.err(`donePM is already running at ${url} (pid ${running.pid}).`);
      process.exit(1);
    }
    // The daemon runs in this process and handles SIGINT/SIGTERM itself.
    await import(daemonEntry);
    break;
  }
  case "stop":
    process.exitCode = await stop(deps);
    break;
  case "status":
    process.exitCode = await status(deps);
    break;
  case "open":
    process.exitCode = await open(deps);
    break;
  case "install-service":
    process.exitCode = await installService(serviceDeps());
    break;
  case "token": {
    const tokenDeps: TokenDeps = { url, fetch, readSecret, out: deps.out, err: deps.err };
    const [, action, id] = positionals;
    if (action === "set") process.exitCode = await setToken(tokenDeps, id);
    else if (action === "delete") process.exitCode = await deleteToken(tokenDeps, id);
    else {
      console.error(`Unknown token command: ${action ?? ""}\n\n${USAGE}`);
      process.exitCode = 2;
    }
    break;
  }
  case "uninstall-service":
    process.exitCode = await uninstallService(serviceDeps());
    break;
  default:
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exitCode = 2;
}
