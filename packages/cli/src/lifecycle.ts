import type { Exec } from "@donepm/daemon/exec";
import type { DaemonStatus } from "./api.js";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface LifecycleDeps extends Io {
  url: string;
  status: () => Promise<DaemonStatus | undefined>;
  exec: Exec;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
}

/** The daemon waits up to 5 s for agents before it exits; give it three times that. */
const STOP_POLLS = 60;
const POLL_MS = 250;

/** `donepm status`: exit 0 when the daemon runs, 1 when it does not. */
export async function status(deps: LifecycleDeps): Promise<number> {
  const s = await deps.status();
  if (!s) {
    deps.out(`donePM is not running (nothing at ${deps.url}).`);
    return 1;
  }
  deps.out(`donePM ${s.version} is running at ${deps.url} (pid ${s.pid}).`);
  deps.out(`Agents running: ${s.runningAgents}`);
  deps.out(`gh: ${s.gh ? describe(s.gh.state) : "not checked yet"}${s.gh?.account ? ` (${s.gh.account})` : ""}`);
  deps.out(`claude: ${s.claude ? describe(s.claude.state) : "not checked yet"}${s.claude?.version ? ` (${s.claude.version})` : ""}`);
  return 0;
}

/** `donepm stop`: SIGTERM to the daemon, then wait until the port is free. */
export async function stop(deps: LifecycleDeps): Promise<number> {
  const s = await deps.status();
  if (!s) {
    deps.out("donePM is not running.");
    return 0;
  }
  deps.kill(s.pid, "SIGTERM");
  if (await waitUntilDown(deps)) {
    deps.out("donePM stopped.");
    return 0;
  }
  deps.err(`donePM (pid ${s.pid}) did not stop. Check the log in ~/Library/Logs/donepm/.`);
  return 1;
}

/** `donepm open`: the board in the default browser. */
export async function open(deps: LifecycleDeps): Promise<number> {
  if (!(await deps.status())) {
    deps.err("donePM is not running. Start it with `donepm start` or `donepm install-service`.");
    return 1;
  }
  const r = await deps.exec("open", [deps.url]);
  if (r.code === 0) return 0;
  deps.err(`Could not open the browser: ${r.stderr.trim()}. Open ${deps.url} yourself.`);
  return 1;
}

export async function waitUntilDown(deps: Pick<LifecycleDeps, "status" | "sleep">): Promise<boolean> {
  for (let i = 0; i < STOP_POLLS; i++) {
    await deps.sleep(POLL_MS);
    if (!(await deps.status())) return true;
  }
  return false;
}

function describe(state: "not_installed" | "not_logged_in" | "ready"): string {
  return { not_installed: "not installed", not_logged_in: "not logged in", ready: "ready" }[state];
}
