import type { Exec } from "../../process/exec.js";

export type CodexState = "not_installed" | "not_logged_in" | "ready";

export interface CodexStatus {
  state: CodexState;
  /** Absolute path from `which codex`. */
  path?: string;
  /** e.g. `0.133.0`, from `codex --version`. */
  version?: string;
}

/**
 * `which codex`, `codex --version`, then `codex login status` (issue #137). Only its exit code is
 * used: 0 when logged in. Its output names the login method and is never read or kept.
 */
export async function detectCodex(exec: Exec): Promise<CodexStatus> {
  const which = await exec("which", ["codex"]);
  const path = which.stdout.trim();
  if (which.code !== 0 || !path) return { state: "not_installed" };
  const ver = await exec("codex", ["--version"]);
  const version = /\d+\.\d+\.\d+/.exec(ver.stdout)?.[0];
  const base = version ? { path, version } : { path };
  const login = await exec("codex", ["login", "status"]);
  return { state: login.code === 0 ? "ready" : "not_logged_in", ...base };
}
