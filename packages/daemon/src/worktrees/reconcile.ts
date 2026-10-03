import { existsSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { agentFailed, type Ctx, type Repo, type WorkItem } from "@donepm/core";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import type { RepoStore } from "../repos/store.js";

/** A worktree under donePM's root that no item points to (spec 7.5). */
export interface OrphanWorktree {
  repoId: string;
  repoPath: string;
  path: string;
  branch?: string;
}

/**
 * Items that wait on an agent whose worktree is gone are failed with the reason (spec 7.5). Path
 * and session are cleared with it: the session belongs to that directory, so a retry starts over.
 */
export function failMissingWorktrees(deps: { items: ItemStore; writer: ItemWriter; ctx: Ctx; log: Log }): void {
  for (const { item } of deps.items.all()) {
    if (item.state !== "running" && item.state !== "needs_you") continue;
    if (!item.worktreePath || existsSync(item.worktreePath)) continue;
    const { worktreePath, agentSessionId: _session, ...rest } = item;
    const cleared = deps.writer.save(rest);
    deps.writer.commit(agentFailed(cleared, deps.ctx, `worktree ${worktreePath} is missing`));
    deps.log.warn({ itemId: item.id, worktreePath }, "worktree missing");
  }
}

/**
 * `git worktree list` per repo, compared with the items: worktrees under `worktreeRoot` that no
 * item uses. Worktrees elsewhere belong to the user and are none of donePM's business. A repo
 * whose listing fails is skipped.
 */
export async function findOrphans(deps: {
  exec: Exec;
  repos: RepoStore;
  items: ItemStore;
  worktreeRoot: string;
  log: Log;
}): Promise<OrphanWorktree[]> {
  const root = withSep(real(deps.worktreeRoot));
  const used = new Set(
    deps.items.all().flatMap(({ item }: { item: WorkItem }) => (item.worktreePath ? [real(item.worktreePath)] : [])),
  );
  const orphans: OrphanWorktree[] = [];
  for (const repo of deps.repos.all()) {
    let listed;
    try {
      listed = await listWorktrees(deps.exec, repo);
    } catch (e) {
      deps.log.warn({ err: e, repo: repo.path }, "git worktree list failed");
      continue;
    }
    for (const wt of listed) {
      const path = real(wt.path);
      if (!path.startsWith(root) || used.has(path)) continue;
      orphans.push({ repoId: repo.id, repoPath: repo.path, path: wt.path, ...(wt.branch ? { branch: wt.branch } : {}) });
    }
  }
  return orphans;
}

/** `git worktree list --porcelain`: blocks of `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<name>`. */
export async function listWorktrees(exec: Exec, repo: Pick<Repo, "path">): Promise<Array<{ path: string; branch?: string }>> {
  const r = await exec("git", ["-C", repo.path, "worktree", "list", "--porcelain"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git worktree list exited with ${r.code}`);
  const out: Array<{ path: string; branch?: string }> = [];
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) out.push({ path: line.slice("worktree ".length) });
    else if (line.startsWith("branch refs/heads/") && out.length) out.at(-1)!.branch = line.slice("branch refs/heads/".length);
  }
  return out;
}

/** Resolves symlinks (`/var` → `/private/var` on macOS) so git's paths and ours compare. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const withSep = (p: string) => (p.endsWith(sep) ? p : p + sep);
