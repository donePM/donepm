import { existsSync } from "node:fs";
import {
  executedPr, prMerged, prMergeOf, worktreeRemovedOnMerge, worktreeRemoveSkipped,
  type Ctx, type PrDraftResult, type WorkItem,
} from "@donepm/core";
import type { DraftStore } from "../drafts/store.js";
import type { EventStore } from "../events/store.js";
import { fetchPrState } from "../gh/pr-state.js";
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
 * Part of each poll (decision D33): for every done item that still has a worktree and whose draft
 * opened a PR, ask GitHub whether the PR was merged, until it was. Merged and the user opted in:
 * remove the worktree like the button does, unless it holds uncommitted or untracked changes.
 * Otherwise record `item.pr_merged` once. Never throws; a failing item does not stop the others.
 */
export async function settleMergedPrs(deps: OnMergeDeps): Promise<void> {
  for (const { item } of deps.items.all()) {
    if (item.state !== "done" || !item.worktreePath) continue;
    const pr = executedPr(deps.drafts.forItem(item.id));
    if (!pr) continue;
    try {
      await settle(deps, item, pr);
    } catch (e) {
      deps.log.warn({ itemId: item.id, err: e }, "checking the merged PR failed");
    }
  }
}

async function settle(deps: OnMergeDeps, item: WorkItem, pr: PrDraftResult): Promise<void> {
  const known = prMergeOf(deps.events.forItem(item.id));
  if (!known.merged) {
    const state = await fetchPrState(deps.exec, pr);
    if (!state.ok) {
      deps.log.warn({ itemId: item.id, pr: pr.url, error: state.error }, "gh pr view failed");
      return;
    }
    if (state.state !== "MERGED") return;
  }
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
