import { z } from "zod";
import type { Exec } from "../../process/exec.js";

export type ClaudeState = "not_installed" | "not_logged_in" | "ready";

export interface ClaudeStatus {
  state: ClaudeState;
  /** Absolute path from `which claude`. */
  path?: string;
  /** e.g. `2.1.288`, from `claude --version`. */
  version?: string;
}

/** Only the field we need; the rest of `claude auth status` (email, org) is ignored on purpose. */
const AuthStatus = z.object({ loggedIn: z.boolean() });

/** `which claude`, `claude --version`, then `claude auth status` (JSON). */
export async function detectClaude(exec: Exec): Promise<ClaudeStatus> {
  const which = await exec("which", ["claude"]);
  const path = which.stdout.trim();
  if (which.code !== 0 || !path) return { state: "not_installed" };
  const ver = await exec("claude", ["--version"]);
  const version = /\d+\.\d+\.\d+/.exec(ver.stdout)?.[0];
  const base = version ? { path, version } : { path };
  const auth = await exec("claude", ["auth", "status"]);
  return { state: loggedIn(auth.stdout) ? "ready" : "not_logged_in", ...base };
}

function loggedIn(stdout: string): boolean {
  try {
    const parsed = AuthStatus.safeParse(JSON.parse(stdout));
    return parsed.success && parsed.data.loggedIn;
  } catch {
    return false;
  }
}
