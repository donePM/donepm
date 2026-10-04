import type { Event } from "../event/types.js";
import type { WorkItem } from "./types.js";

/** How long finished items stay on the board and in the archive (decision D37, user config). */
export interface Retention {
  /** Hours from finished to archived. 0 archives on the next poll. */
  archiveAfterHours: number;
  /** Days from archived to deleted. `null`: never delete. */
  deleteAfterDays: number | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const mergeSeen = (e: Event) =>
  e.type === "item.pr_merged" || (e.type === "worktree.removed" && e.payload.reason === "pr_merged");

/**
 * When the item's work was finished on the board and in git, or undefined while it is not (D37).
 * Finished is `done` and, if a draft opened a PR, that PR merged. A done item without a PR (closed
 * upstream, dismissed) has nothing left in git: it finished when it became done. With a PR it
 * finished when the merge was seen, or when it became done again after that. Someone else's pull
 * request (D47) is finished once it is done and that pull request is closed or merged.
 */
export function finishedAt(item: WorkItem, events: readonly Event[], hasPr: boolean): string | undefined {
  if (item.state !== "done") return undefined;
  // Someone else's pull request, reviewed, may still wait for its merge (D47).
  if (item.prStatus?.state === "OPEN") return undefined;
  const closed = item.prStatus?.closedAt;
  if (closed !== undefined) return closed > item.stateSince ? closed : item.stateSince;
  if (!hasPr) return item.stateSince;
  const merge = events.find(mergeSeen);
  if (!merge) return undefined;
  return merge.at > item.stateSince ? merge.at : item.stateSince;
}

/** The finished item has been on the board for `archiveAfterHours`. */
export function archiveDue(finished: string, now: string, retention: Pick<Retention, "archiveAfterHours">): boolean {
  return Date.parse(now) - Date.parse(finished) >= retention.archiveAfterHours * HOUR_MS;
}

/**
 * The archived item has been in the archive for `deleteAfterDays` and its worktree is gone. An item
 * that still has a worktree is kept until the user (or the merge, D33) removes it.
 */
export function purgeDue(item: WorkItem, now: string, retention: Pick<Retention, "deleteAfterDays">): boolean {
  if (item.archivedAt === undefined || item.worktreePath !== undefined || retention.deleteAfterDays === null) return false;
  return Date.parse(now) - Date.parse(item.archivedAt) >= retention.deleteAfterDays * DAY_MS;
}
