import { isUnder, sameDir } from "./paths.js";

/**
 * Former worktree roots after `worktreeRoot` changed from `prev` to `next` (issue #93): the old
 * root joins them, the new one leaves them (switching back is not a former root). Paths as the user
 * wrote them; `expand` resolves `~`.
 */
export function formerRootsAfter(
  prev: { worktreeRoot: string; previousWorktreeRoots: readonly string[] },
  next: { worktreeRoot: string },
  expand: (p: string) => string,
): string[] {
  const out: string[] = [];
  for (const root of [...prev.previousWorktreeRoots, prev.worktreeRoot]) {
    if (sameDir(expand(root), expand(next.worktreeRoot))) continue;
    if (out.some((r) => sameDir(expand(r), expand(root)))) continue;
    out.push(root);
  }
  return out;
}

/** The former roots that still hold a worktree: an item's or an orphan. Orphan detection drops the rest. */
export function occupiedRoots(
  roots: readonly string[],
  worktreePaths: readonly string[],
  expand: (p: string) => string,
): string[] {
  return roots.filter((root) => worktreePaths.some((p) => isUnder(p, expand(root))));
}
