import type { Event } from "../event/types.js";

/** What the events say about a done item's merged pull request (decision D33). */
export interface PrMerge {
  /** The PR was seen merged: `item.pr_merged`, or the worktree was removed for it. */
  merged: boolean;
  /** Why the daemon left the worktree in place, unless it was removed since. */
  removeSkipped?: string;
}

const removedOnMerge = (e: Event) => e.type === "worktree.removed" && e.payload.reason === "pr_merged";

export function prMergeOf(events: readonly Event[]): PrMerge {
  const merged = events.some((e) => e.type === "item.pr_merged" || removedOnMerge(e));
  const last = events.findLast((e) => e.type === "worktree.remove_skipped" || e.type === "worktree.removed");
  const reason = last?.type === "worktree.remove_skipped" ? last.payload.reason : undefined;
  return { merged, ...(typeof reason === "string" ? { removeSkipped: reason } : {}) };
}
