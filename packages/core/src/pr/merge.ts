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
 * mergeable. Nothing else is required; GitHub's branch protection still has the last word.
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
  return blockers;
}

/** Whether the daemon merges the pull request on its own once it is ready (D47). */
export function autoMergeOn(item: Pick<WorkItem, "autoMerge">, repoDefault: boolean): boolean {
  return item.autoMerge ?? repoDefault;
}

/** The user ticked or cleared "Merge automatically" on the card (D47); ticking is the approval in advance. */
export function autoMergeSet(item: WorkItem, ctx: Ctx, on: boolean): Transition {
  if (item.source !== "github-pr") throw new InvalidTransitionError("autoMergeSet", item.state);
  const at = ctx.now();
  return {
    item: { ...item, autoMerge: on, updatedAt: at },
    events: [{ id: ctx.newId(), itemId: item.id, at, actor: "user", type: "pr.auto_merge_set", payload: { on } }],
  };
}

/**
 * The daemon's automatic merge failed (D47). It turns auto-merge off for the item, so a refusal is
 * not tried again on every poll; the user reads why and merges or ticks it again.
 */
export function autoMergeFailed(item: WorkItem, ctx: Ctx, failure: { method: string; error: string }): Transition {
  if (item.source !== "github-pr") throw new InvalidTransitionError("autoMergeFailed", item.state);
  const at = ctx.now();
  return {
    item: { ...item, autoMerge: false, updatedAt: at },
    events: [{ id: ctx.newId(), itemId: item.id, at, actor: "system", type: "pr.merge_failed", payload: { ...failure, auto: true } }],
  };
}
