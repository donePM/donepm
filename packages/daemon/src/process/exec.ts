import { execFile } from "node:child_process";

export interface ExecResult {
  /** Exit code; -1 when the process could not be started (e.g. ENOENT). */
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
}

/** Runs a command without a shell. Never throws; failures are in `code` and `stderr`. */
export type Exec = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

export const exec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout, stderr });
        const code = typeof err.code === "number" ? err.code : -1;
        resolve({ code, stdout: stdout ?? "", stderr: stderr || err.message });
      },
    );
  });
