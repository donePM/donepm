import type { Exec } from "../process/exec.js";
import { WorktreeError } from "./create.js";
import { setupCopies } from "./setup.js";

/**
 * Paths from `git status --porcelain=v1 -z`: `XY path` entries; a rename or copy is followed by
 * its source path as a separate entry, which is skipped.
 */
export function porcelainPaths(out: string): string[] {
  const entries = out.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    paths.push(e.slice(3));
    if (e[0] === "R" || e[0] === "C") i++;
  }
  return paths;
}

/**
 * Uncommitted and untracked files in a worktree, without what `.donepm/setup.yml` copied in (D25).
 * Empty means the worktree can go without losing anything. Throws WorktreeError.
 */
export async function uncommittedChanges(exec: Exec, worktree: string): Promise<string[]> {
  const r = await exec("git", ["-C", worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (r.code !== 0) throw new WorktreeError("git status failed", r.stderr);
  const copied = new Set(await setupCopies(worktree));
  return porcelainPaths(r.stdout).filter((p) => !copied.has(p));
}
