import type { Exec } from "../process/exec.js";

/** The commit a worktree is at, which the CI wait's builds should be of (issue #143); undefined if it cannot tell. */
export async function worktreeHead(exec: Exec, worktree: string | undefined): Promise<string | undefined> {
  if (!worktree) return undefined;
  const r = await exec("git", ["rev-parse", "HEAD"], { cwd: worktree });
  const sha = r.stdout.trim();
  return r.code === 0 && /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
}
