import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { worktreeMoved, type Ctx, type WorkItem } from "@donepm/core";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import type { RepoStore } from "../repos/store.js";
import { isUnder, real } from "./paths.js";

/** An item's worktree that lies under the old root when the worktree root changes (issue #93). */
export interface WorktreeAtOldRoot {
  itemId: string;
  title: string;
  path: string;
  /** An agent works in it; it is not moved. */
  running: boolean;
}

export interface MoveOutcome {
  moved: Array<{ itemId: string; title: string; from: string; to: string }>;
  skipped: Array<{ itemId: string; title: string; path: string; reason: string }>;
}

interface Deps {
  items: ItemStore;
  agentActive: (itemId: string) => boolean;
}

const busy = (deps: Deps, item: WorkItem) => item.state === "running" || deps.agentActive(item.id);

/** Items whose worktree lies under `root`, review worktrees (D41) included. */
export function worktreesUnder(deps: Deps, root: string): WorktreeAtOldRoot[] {
  return deps.items.all().flatMap(({ item }) =>
    item.worktreePath && isUnder(item.worktreePath, root)
      ? [{ itemId: item.id, title: item.title, path: item.worktreePath, running: busy(deps, item) }]
      : [],
  );
}

/**
 * Moves every item worktree under `from` to the same place under `to`, one
 * `git -C <main clone> worktree move` each, so git's metadata follows (issue #93). The item gets
 * the new path and a `worktree.moved` event. Never moves a worktree an agent works in, and never
 * overwrites: those, and any git failure, are skipped with the reason. The session stays (D44).
 */
export async function moveWorktrees(
  deps: Deps & { repos: RepoStore; writer: ItemWriter; exec: Exec; ctx: Ctx; log: Log },
  from: string,
  to: string,
): Promise<MoveOutcome> {
  const out: MoveOutcome = { moved: [], skipped: [] };
  const fromReal = real(from);
  for (const { itemId } of worktreesUnder(deps, from)) {
    // Read again per item: an earlier move awaits git, and the user may start an agent meanwhile.
    const item = deps.items.get(itemId)?.item;
    if (!item?.worktreePath) continue;
    const path = item.worktreePath;
    const skip = (reason: string) => out.skipped.push({ itemId, title: item.title, path, reason });
    if (busy(deps, item)) {
      skip("its agent is running");
      continue;
    }
    const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
    if (!repo) {
      skip("its repository is not known");
      continue;
    }
    if (!existsSync(path)) {
      skip("the worktree is missing");
      continue;
    }
    const target = join(to, relative(fromReal, real(path)));
    if (existsSync(target)) {
      skip(`${target} already exists`);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    const r = await deps.exec("git", ["-C", repo.path, "worktree", "move", path, target]);
    if (r.code !== 0) {
      skip(r.stderr.trim() || `git worktree move exited with ${r.code}`);
      continue;
    }
    const current = deps.items.get(itemId)?.item ?? item;
    deps.writer.commit(worktreeMoved(current, deps.ctx, { from: path, to: target }));
    deps.log.info({ itemId, from: path, to: target }, "worktree moved");
    out.moved.push({ itemId, title: item.title, from: path, to: target });
  }
  return out;
}
