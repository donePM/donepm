import type { ItemView } from "../api/types";

/** What a done card says about its PR's merge and the worktree (D33). */
export type MergeNote =
  | { kind: "pending" }
  | { kind: "merged" }
  | { kind: "skipped"; reason: string };

/**
 * `pending`: the user opted in and the worktree waits for the merge. `skipped`: merged, but the
 * daemon kept the worktree, e.g. for uncommitted changes. `merged`: merged, nothing left to say.
 */
export function mergeNote(item: ItemView, removeOnMerge: boolean): MergeNote | undefined {
  const pr = item.pr;
  if (!pr || item.state !== "done") return undefined;
  if (!pr.merged) return removeOnMerge && item.worktreePath ? { kind: "pending" } : undefined;
  if (removeOnMerge && item.worktreePath && pr.removeSkipped) return { kind: "skipped", reason: pr.removeSkipped };
  return { kind: "merged" };
}
