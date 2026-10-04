import type { Exec } from "../process/exec.js";

/**
 * The files that conflict when `branch` is merged into `origin/<base>`, computed in the clone
 * without touching a worktree (`git merge-tree`, git 2.38+). The daemon fetches the base first; the
 * agent never does. Empty when git finds no conflict or cannot tell: the list is a hint, GitHub's
 * `mergeable` is the verdict.
 */
export async function conflictFiles(exec: Exec, repoPath: string, base: string, branch: string): Promise<string[]> {
  await exec("git", ["-C", repoPath, "fetch", "origin", base], { timeoutMs: 60_000 });
  const r = await exec("git", ["-C", repoPath, "merge-tree", "--write-tree", "--name-only", "-z", `refs/remotes/origin/${base}`, branch]);
  // Exit 1 means conflicts; 0 a clean merge, anything else an error.
  if (r.code !== 1) return [];
  return parseConflictFiles(r.stdout);
}

/** `<tree>\0<file>\0<file>\0\0<messages>`: the names between the tree and the empty field. */
export function parseConflictFiles(stdout: string): string[] {
  const fields = stdout.split("\0");
  const end = fields.indexOf("", 1);
  return [...new Set(fields.slice(1, end === -1 ? fields.length : end))].filter(Boolean);
}
