import { existsSync } from "node:fs";
import {
  prMerged, prMergeOf, worktreeRemovedOnMerge, worktreeRemoveSkipped,
  type Ctx, type PrDraftResult, type WorkItem,
} from "@donepm/core";
import type { DraftStore } from "../drafts/store.js";
import type { EventStore } from "../events/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import type { Exec } from "../process/exec.js";
import type { RepoStore } from "../repos/store.js";
import { uncommittedChanges } from "./dirty.js";
import { removeWorktree } from "./remove.js";

export const UNCOMMITTED = "uncommitted changes";

export interface OnMergeDeps {
  items: ItemStore;
  events: EventStore;
  drafts: DraftStore;
  repos: RepoStore;
  writer: ItemWriter;
  exec: Exec;
  ctx: Ctx;
  log: Log;
  /** The user's `removeWorktreeOnMerge`. */
  removeOnMerge: () => boolean;
  agentActive: (itemId: string) => boolean;
}

/**
 * A done item whose PR was merged (decision D33), called by the PR poll (`watchPrs`) once GitHub
 * said so or the events already know. The user opted in: remove the worktree like the button does,
 * unless it holds uncommitted or untracked changes. Otherwise record `item.pr_merged` once.
 */
export async function settleMerged(deps: OnMergeDeps, item: WorkItem, pr: PrDraftResult): Promise<void> {
  const known = prMergeOf(deps.events.forItem(item.id));
  const facts = { number: pr.number, url: pr.url };
  const markMerged = () => {
    if (!known.merged) deps.writer.commit(prMerged(itemNow(deps, item), deps.ctx, facts));
  };

  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!deps.removeOnMerge() || !repo || deps.agentActive(item.id)) return markMerged();

  const path = item.worktreePath!;
  // A directory that is already gone holds nothing to lose; the removal only prunes.
  const dirty = existsSync(path) ? await uncommittedChanges(deps.exec, path) : [];
  const now = itemNow(deps, item);
  if (now.state !== "done" || now.worktreePath !== path) return;
  if (dirty.length) {
    markMerged();
    if (known.removeSkipped !== UNCOMMITTED) {
      deps.writer.commit(worktreeRemoveSkipped(itemNow(deps, item), deps.ctx, UNCOMMITTED, { ...facts, files: dirty.slice(0, 20) }));
    }
    return;
  }

  await removeWorktree(deps.exec, repo.path, path);
  deps.writer.commit(
    worktreeRemovedOnMerge(itemNow(deps, item), deps.ctx, { path, ...(item.branch ? { branch: item.branch } : {}), ...facts }),
  );
}

/** Re-read the item: it may have changed while git and gh ran. */
function itemNow(deps: OnMergeDeps, fallback: WorkItem): WorkItem {
  return deps.items.get(fallback.id)?.item ?? fallback;
}
