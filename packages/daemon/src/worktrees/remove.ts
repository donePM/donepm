import { existsSync } from "node:fs";
import { worktreeRemoved, type Ctx, type WorkItem } from "@donepm/core";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Exec } from "../process/exec.js";
import type { RepoStore } from "../repos/store.js";
import { WorktreeError } from "./create.js";
import type { OrphanWorktree } from "./reconcile.js";

export class RemoveError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "RemoveError";
  }
}

/**
 * `git worktree remove --force` and `git worktree prune` (spec 7.4). The branch is kept. A
 * directory that is already gone only needs the prune. Throws WorktreeError.
 */
export async function removeWorktree(exec: Exec, repoPath: string, path: string): Promise<void> {
  if (existsSync(path)) {
    const r = await exec("git", ["-C", repoPath, "worktree", "remove", "--force", path]);
    if (r.code !== 0) throw new WorktreeError("git worktree remove failed", r.stderr);
  }
  const prune = await exec("git", ["-C", repoPath, "worktree", "prune"]);
  if (prune.code !== 0) throw new WorktreeError("git worktree prune failed", prune.stderr);
}

/**
 * The user's "Remove worktree" on a done or failed card (spec 7.4); the poll removes a merged PR's
 * worktree through `removeWorktree` only when the user opted in (D33). Throws
 * RemoveError before, WorktreeError while git runs.
 */
export async function removeItemWorktree(
  deps: { items: ItemStore; repos: RepoStore; writer: ItemWriter; exec: Exec; ctx: Ctx; agentActive: (itemId: string) => boolean },
  itemId: string,
): Promise<WorkItem> {
  const item = deps.items.get(itemId)?.item;
  if (!item) throw new RemoveError(404, "item not found");
  if (item.state !== "done" && item.state !== "failed") throw new RemoveError(409, `item is ${item.state}`);
  if (deps.agentActive(item.id)) throw new RemoveError(409, "the agent is still running");
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo || !item.worktreePath) throw new RemoveError(409, "the item has no worktree");
  await removeWorktree(deps.exec, repo.path, item.worktreePath);
  const current = deps.items.get(itemId)?.item ?? item;
  return deps.writer.commit(
    worktreeRemoved(current, deps.ctx, { path: item.worktreePath, ...(item.branch ? { branch: item.branch } : {}) }),
  );
}

/** Settings' Remove on an orphaned worktree. Only paths in the current orphan list are removed. */
export async function removeOrphan(
  deps: { exec: Exec; orphans: () => Promise<OrphanWorktree[]> },
  path: string,
): Promise<void> {
  const orphan = (await deps.orphans()).find((o) => o.path === path);
  if (!orphan) throw new RemoveError(404, "no orphaned worktree at this path");
  await removeWorktree(deps.exec, orphan.repoPath, orphan.path);
}
