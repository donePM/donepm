import {
  executedPr, prConflicted, prConflictOf, prConflictResolved, prMergeOf,
  type PrConflict, type PrDraftResult, type WorkItem,
} from "@donepm/core";
import { fetchPrState, type PrState } from "../gh/pr-state.js";
import { settleMerged, type OnMergeDeps } from "../worktrees/on-merge.js";
import { conflictFiles } from "./conflict-files.js";

export type PrWatchDeps = OnMergeDeps;

/**
 * Part of each poll, after the CI watch: one `gh pr view` per open PR donePM opened. A done item
 * with a worktree is asked until its PR is merged (D33). A done or CI-waiting item whose PR
 * conflicts with its base comes back to the user, and goes back once GitHub reports it mergeable
 * again (D36). Never throws; a failing item does not stop the others.
 */
export async function watchPrs(deps: PrWatchDeps): Promise<void> {
  for (const { item } of deps.items.all()) {
    const pr = executedPr(deps.drafts.forItem(item.id));
    if (!pr) continue;
    try {
      await watch(deps, item, pr);
    } catch (e) {
      deps.log.warn({ itemId: item.id, err: e }, "checking the PR failed");
    }
  }
}

async function watch(deps: PrWatchDeps, item: WorkItem, pr: PrDraftResult): Promise<void> {
  const events = deps.events.forItem(item.id);
  const conflict = prConflictOf(events);
  const settles = item.state === "done" && item.worktreePath !== undefined;
  // A merge the events already know needs no gh call; only the worktree may still go.
  if (settles && prMergeOf(events).merged) return settleMerged(deps, item, pr);
  // A known conflict is asked about until it ends, wherever the item went meanwhile.
  if (!settles && item.state !== "checking" && !conflict) return;

  const state = await fetchPrState(deps.exec, pr);
  if (!state.ok) {
    deps.log.warn({ itemId: item.id, pr: pr.url, error: state.error }, "gh pr view failed");
    return;
  }
  await noteConflict(deps, item, pr, state, conflict);
  const now = itemNow(deps, item);
  if (state.state === "MERGED" && now.state === "done" && now.worktreePath !== undefined) await settleMerged(deps, now, pr);
}

/**
 * Records a conflict once when GitHub reports `CONFLICTING`, and its end once the PR is mergeable,
 * merged or closed. `UNKNOWN` (not computed yet after a push to the base) changes nothing.
 */
async function noteConflict(
  deps: PrWatchDeps,
  item: WorkItem,
  pr: PrDraftResult,
  state: Extract<PrState, { ok: true }>,
  known: PrConflict | undefined,
): Promise<void> {
  if (known) {
    if (state.state === "OPEN" && state.mergeable !== "MERGEABLE") return;
    deps.writer.commit(prConflictResolved(itemNow(deps, item), deps.ctx, known));
    return;
  }
  if (state.state !== "OPEN" || state.mergeable !== "CONFLICTING") return;
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  const base = state.baseRefName ?? repo?.defaultBranch ?? "main";
  const files = repo && item.branch ? await conflictFiles(deps.exec, repo.path, base, item.branch) : [];
  // Re-read: git ran meanwhile, and the user may have moved the item.
  const now = itemNow(deps, item);
  if (now.state !== "done" && now.state !== "checking") return;
  deps.writer.commit(prConflicted(now, deps.ctx, { number: pr.number, url: pr.url, base, files }));
}

function itemNow(deps: PrWatchDeps, fallback: WorkItem): WorkItem {
  return deps.items.get(fallback.id)?.item ?? fallback;
}
