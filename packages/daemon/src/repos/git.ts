import type { Exec } from "../process/exec.js";

/** `origin` URL as configured, or undefined when the clone has no origin. */
export async function readOrigin(exec: Exec, repoPath: string): Promise<string | undefined> {
  const r = await exec("git", ["-C", repoPath, "remote", "get-url", "origin"]);
  const url = r.stdout.trim();
  return r.code === 0 && url ? url : undefined;
}

export const FALLBACK_DEFAULT_BRANCH = "main";

/**
 * Default branch from `git symbolic-ref refs/remotes/origin/HEAD` (spec 4.6). Clones made with
 * `git init` + `remote add` lack that ref; then the fallback is used.
 */
export async function readDefaultBranch(exec: Exec, repoPath: string): Promise<{ branch: string; fromRef: boolean }> {
  const r = await exec("git", ["-C", repoPath, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const ref = r.stdout.trim();
  if (r.code === 0 && ref.startsWith("origin/") && ref.length > "origin/".length) {
    return { branch: ref.slice("origin/".length), fromRef: true };
  }
  return { branch: FALLBACK_DEFAULT_BRANCH, fromRef: false };
}
