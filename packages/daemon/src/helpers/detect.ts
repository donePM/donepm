import type { Exec } from "../process/exec.js";

/**
 * Optional command-line helpers an agent may use, such as a browser driver (issue #152). The daemon
 * only reports whether they are there; nothing depends on them. Each id is also the command looked
 * up on `PATH`.
 */
export const HELPERS = ["playwright-cli"] as const;

export interface HelperStatus {
  installed: boolean;
  /** Absolute path from `which`. */
  path?: string;
  /** e.g. `0.1.1`, from `<cmd> --version`. */
  version?: string;
}

/** `which <cmd>`, then `<cmd> --version`; a helper without a readable version is still installed. */
export async function detectHelper(exec: Exec, command: string): Promise<HelperStatus> {
  const which = await exec("which", [command]);
  const path = which.stdout.trim();
  if (which.code !== 0 || !path) return { installed: false };
  const ver = await exec(command, ["--version"]);
  const version = ver.code === 0 ? versionIn(ver.stdout) : undefined;
  return version ? { installed: true, path, version } : { installed: true, path };
}

/**
 * A line that is only a version wins, since a CLI may print an update notice around it
 * (`Update available for @playwright/cli: 0.1.18 → 0.1.22`); otherwise the first version found.
 */
function versionIn(stdout: string): string | undefined {
  const lines = stdout.split("\n").map((l) => l.trim());
  const alone = lines.map((l) => /^v?(\d+\.\d+\.\d+[\w.+-]*)$/.exec(l)?.[1]).find(Boolean);
  return alone ?? /\d+\.\d+\.\d+[\w.+-]*/.exec(stdout)?.[0];
}

/** Every helper, keyed by id. */
export async function detectHelpers(exec: Exec, helpers: readonly string[] = HELPERS): Promise<Record<string, HelperStatus>> {
  const found = await Promise.all(helpers.map(async (id) => [id, await detectHelper(exec, id)] as const));
  return Object.fromEntries(found);
}
