import type { Ctx } from "../ids.js";
import { InvalidTransitionError, type Transition } from "../item/transitions.js";
import type { ItemState, WorkItem } from "../item/types.js";

/** How `gh pr merge` merges: `--squash`, `--merge` or `--rebase`. */
export const MERGE_METHODS = ["squash", "merge", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

/** A pull request is merged from these states only; the others are busy or wait on the user. */
const MERGE_STATES: ReadonlySet<ItemState> = new Set(["ready", "done"]);

/**
 * Why someone else's pull request cannot be merged from donePM yet (D47), empty when it can: the
 * user's own latest review approved it, its checks passed (or it has none), and GitHub says it is
 * mergeable. A branch that branch protection wants up to date
 * with its base (`mergeState` `BEHIND`) waits for that. Nothing else is required; GitHub's branch
 * protection still has the last word.
 */
export function mergeBlockers(item: Pick<WorkItem, "source" | "state" | "prStatus">): string[] {
  if (item.source !== "github-pr") return ["not someone else's pull request"];
  const s = item.prStatus;
  if (!s) return ["status not read yet"];
  if (s.state !== undefined && s.state !== "OPEN") return [`pull request is ${s.state.toLowerCase()}`];
  const blockers: string[] = [];
  if (!MERGE_STATES.has(item.state)) blockers.push("the item is busy or waits on you");
  if (s.viewerReview !== "APPROVED") blockers.push("you have not approved it");
  if (s.checks !== undefined && s.checks !== "SUCCESS") blockers.push("checks have not passed");
  if (s.mergeable !== "MERGEABLE") blockers.push(s.mergeable === "CONFLICTING" ? "it has conflicts" : "GitHub has not said it is mergeable");
  if (s.mergeState === "BEHIND") blockers.push(`the branch is behind ${s.base}; waiting for it to be updated`);
  return blockers;
}

/** Whether the daemon merges the pull request on its own once it is ready (D47). */
export function autoMergeOn(item: Pick<WorkItem, "autoMerge">, repoDefault: boolean): boolean {
  return item.autoMerge ?? repoDefault;
}

/**
 * Whether the daemon merges the pull request on this poll (D47): auto-merge is on, nothing blocks it,
 * and it is not held after a passing failure on the same head and merge state.
 */
export function autoMergeDue(item: Pick<WorkItem, "source" | "state" | "prStatus" | "autoMerge" | "autoMergeHeld">, repoDefault: boolean): boolean {
  if (!autoMergeOn(item, repoDefault) || mergeBlockers(item).length) return false;
  const held = item.autoMergeHeld;
  return !held || held.head !== item.prStatus?.head || held.mergeState !== item.prStatus?.mergeState;
}

/**
 * `gh pr merge` refusals that pass on their own (D47): the branch is behind its base, checks or
 * mergeability are still being worked out, or a branch moved during the merge. Anything else
 * (conflicts, permissions, a merge queue, an unknown message) is a refusal the user has to look at.
 */
const PASSING = [
  /not up to date with the base branch/i,
  /head branch is out of date|branch is out-of-date/i,
  /(base|head) branch was modified/i,
  /required status checks?\b[^\n]*\b(is|are) (pending|expected|in progress)/i,
  /checks? (is|are) (still )?(pending|in progress)/i,
  /mergeab(le|ility)[^\n]*(unknown|not (yet )?(been )?computed|being computed)/i,
];

/** Whether a failed `gh pr merge` may simply be tried again later (D47). */
export function mergeFailurePasses(error: string): boolean {
  return PASSING.some((re) => re.test(error));
}

/** The user ticked or cleared "Merge automatically" on the card (D47); ticking is the approval in advance. */
export function autoMergeSet(item: WorkItem, ctx: Ctx, on: boolean): Transition {
  if (item.source !== "github-pr") throw new InvalidTransitionError("autoMergeSet", item.state);
  const at = ctx.now();
  const { autoMergeHeld: _held, ...rest } = item;
  return {
    item: { ...rest, autoMerge: on, updatedAt: at },
    events: [{ id: ctx.newId(), itemId: item.id, at, actor: "user", type: "pr.auto_merge_set", payload: { on } }],
  };
}

/**
 * The daemon's automatic merge failed (D47). A refusal that passes on its own (`mergeFailurePasses`,
 * e.g. the branch is behind its base) keeps auto-merge on, held until the pull request's head or
 * merge state changes, so it is tried again once there is news and not on every poll. Any other
 * refusal turns auto-merge off for the item; the user reads why and merges or ticks it again. The
 * event's `staysOn` says which.
 */
export function autoMergeFailed(item: WorkItem, ctx: Ctx, failure: { method: string; error: string }): Transition {
  if (item.source !== "github-pr") throw new InvalidTransitionError("autoMergeFailed", item.state);
  const at = ctx.now();
  const staysOn = mergeFailurePasses(failure.error);
  const { autoMergeHeld: _held, ...rest } = item;
  const s = item.prStatus;
  const next: WorkItem = staysOn
    ? {
        ...rest,
        autoMergeHeld: { ...(s?.head !== undefined ? { head: s.head } : {}), ...(s?.mergeState !== undefined ? { mergeState: s.mergeState } : {}) },
        updatedAt: at,
      }
    : { ...rest, autoMerge: false, updatedAt: at };
  return {
    item: next,
    events: [{ id: ctx.newId(), itemId: item.id, at, actor: "system", type: "pr.merge_failed", payload: { ...failure, auto: true, staysOn } }],
  };
}
