import {
  executedPr, newFeedback, prConflicted, prConflictOf, prConflictResolved, prFeedback, prMergeOf,
  type PrConflict, type PrDraftResult, type WorkItem,
} from "@donepm/core";
import { fetchPrFeedback } from "../gh/pr-feedback.js";
import { fetchPrState, type PrState } from "../gh/pr-state.js";
import { settleMerged, type OnMergeDeps } from "../worktrees/on-merge.js";
import { conflictFiles } from "./conflict-files.js";

export type PrWatchDeps = OnMergeDeps;

/**
 * Part of each poll, after the CI watch: one `gh pr view` per open PR donePM opened. A done item
 * is asked until its PR is merged (D33, D37). A done or CI-waiting item whose PR
 * conflicts with its base comes back to the user, and goes back once GitHub reports it mergeable
 * again (D36). A done item whose open PR got new review feedback comes back too (D39). Never throws; a failing item does not stop the others.
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
  const merged = prMergeOf(events).merged;
  // Done with a worktree: settled on merge (D33). Done without one: asked until the merge is
  // recorded, which is when the item counts as finished (D37).
  const settles = item.state === "done" && (item.worktreePath !== undefined || !merged);
  // A merge the events already know needs no gh call; only the worktree may still go.
  if (settles && merged) return settleMerged(deps, item, pr);
  // A known conflict is asked about until it ends, wherever the item went meanwhile.
  if (!settles && item.state !== "checking" && !conflict) return;

  const state = await fetchPrState(deps.exec, pr);
  if (!state.ok) {
    deps.log.warn({ itemId: item.id, pr: pr.url, error: state.error }, "gh pr view failed");
    return;
  }
  await noteConflict(deps, item, pr, state, conflict);
  const now = itemNow(deps, item);
  if (state.state === "MERGED" && now.state === "done") await settleMerged(deps, now, pr);
  if (state.state === "OPEN" && now.state === "done") await noteFeedback(deps, now, pr);
}

/**
 * One GraphQL call per open PR of a done item (D39). Feedback no earlier `pr.feedback` recorded
 * brings the item back to the user; what arrived while the agent worked counts once it is done.
 */
async function noteFeedback(deps: PrWatchDeps, item: WorkItem, pr: PrDraftResult): Promise<void> {
  const fetched = await fetchPrFeedback(deps.exec, pr);
  if (!fetched.ok) {
    deps.log.warn({ itemId: item.id, pr: pr.url, error: fetched.error }, "reading the PR's reviews failed");
    return;
  }
  const entries = newFeedback(fetched.entries, deps.events.forItem(item.id));
  if (entries.length === 0) return;
  const now = itemNow(deps, item);
  if (now.state !== "done") return;
  deps.writer.commit(prFeedback(now, deps.ctx, { number: pr.number, url: pr.url, entries }));
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
