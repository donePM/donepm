import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** A running `claude` process as the runner sees it. Tests use a fake. */
export interface AgentProcess {
  /** Write one NDJSON line to stdin (the newline is added). */
  write(line: string): void;
  onStdoutLine(cb: (line: string) => void): void;
  onStderr(cb: (chunk: string) => void): void;
  /** After stdout is drained. `code` is null when killed by a signal; -1 when it never started. */
  onExit(cb: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal: NodeJS.Signals): void;
}

export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type ProcessFactory = (cmd: string, args: string[], opts: SpawnOptions) => AgentProcess;

/**
 * Real child process: stdin kept open for the whole session (spec 9.2).
 *
 * The agent leads its own process group, and `kill` signals the whole group (#115). Test runs,
 * dev servers and workers the agent started then end with it instead of living on as orphans of
 * launchd. Bloom does the same with `killpg`.
 */
export const spawnProcess: ProcessFactory = (cmd, args, opts) => {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"], detached: true });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let exitCbs: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  const stderrCbs: Array<(chunk: string) => void> = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => stderrCbs.forEach((cb) => cb(chunk)));
  // A write after the child died raises EPIPE on stdin; the exit handler reports the failure.
  child.stdin.on("error", () => {});

  let exited = false;
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (exited) return;
    exited = true;
    const cbs = exitCbs;
    exitCbs = [];
    cbs.forEach((cb) => cb(code, signal));
  };
  child.on("error", (err) => {
    stderrCbs.forEach((cb) => cb(`${err.message}\n`));
    finish(-1, null);
  });
  // `close` fires after stdio is closed, so every stdout line has been read.
  child.on("close", (code, signal) => finish(code, signal));

  return {
    write: (line) => {
      if (child.stdin.writable) child.stdin.write(line + "\n");
    },
    onStdoutLine: (cb) => lines.on("line", cb),
    onStderr: (cb) => stderrCbs.push(cb),
    onExit: (cb) => exitCbs.push(cb),
    kill: (signal) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is gone already (ESRCH); the agent itself may still be reaped.
        child.kill(signal);
      }
    },
  };
};
