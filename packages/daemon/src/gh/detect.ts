import { GITHUB_COM } from "@donepm/core";
import type { Exec } from "../process/exec.js";

export type GhState = "not_installed" | "not_logged_in" | "ready";

export interface GhStatus {
  state: GhState;
  /** Absolute path from `which gh`. */
  path?: string;
  account?: string;
}

/**
 * Spec 6.1: `which gh`, then `gh auth status` for one GitHub host (issue #140). Without
 * `--hostname`, gh checks every host it knows and fails if any one is logged out.
 */
export async function detectGh(exec: Exec, host: string = GITHUB_COM): Promise<GhStatus> {
  const which = await exec("which", ["gh"]);
  const path = which.stdout.trim();
  if (which.code !== 0 || !path) return { state: "not_installed" };
  const auth = await exec("gh", ["auth", "status", "--hostname", host]);
  if (auth.code !== 0) return { state: "not_logged_in", path };
  const account = /account (\S+)/.exec(auth.stdout + auth.stderr)?.[1];
  return account ? { state: "ready", path, account } : { state: "ready", path };
}
