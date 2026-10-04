/** An issue to work on, or someone else's pull request that asks for the user's review (D40). */
export type ItemSource = "github-issue" | "github-pr";

/** `checking`: the PR is open and its CI runs; no agent runs (decision D35). */
export type ItemState = "ready" | "running" | "needs_you" | "checking" | "done" | "failed";

export interface WorkItem {
  id: string;
  source: ItemSource;
  /** `owner/repo#123` */
  externalId: string;
  externalUrl: string;
  /** Local clone; absent when no clone matches the issue's repository ("no local clone"). */
  repoId?: string;
  title: string;
  body: string;
  labels: string[];
  state: ItemState;
  /** Playbook name. */
  playbook: string;
  /** `priorityTier(labels)`: 0 is the most urgent. Recomputed whenever the labels change. */
  priority: number;
  /** When the issue was opened on GitHub. Absent on items collected before it was fetched. */
  issueCreatedAt?: string;
  /** When the agent first started on the item. Never moves after that, not even on retry. */
  startedAt?: string;
  /** When the item entered its current state. Transitions that keep the state leave it alone. */
  stateSince: string;
  worktreePath?: string;
  branch?: string;
  /**
   * The branch the work is compared against when it is not the repository's default: a reviewed
   * pull request's base (D41). Set when the worktree is made.
   */
  baseBranch?: string;
  /** Claude `session_id`, for `--resume`. */
  agentSessionId?: string;
  /** The issue was closed upstream while the item was not done. */
  closedUpstream?: boolean;
  /**
   * When the retention job took the finished item off the board (decision D37). Archived items
   * keep everything; they leave the database `deleteAfterDays` later.
   */
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}
