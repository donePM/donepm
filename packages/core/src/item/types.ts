import type { AgentKind } from "../agent/kind.js";
import type { PrStatus } from "../pr/status.js";

/**
 * An issue to work on, or someone else's pull request that is assigned to the user or asks for their
 * review (D40, D47).
 */
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
  /** Login of whoever opened the pull request (`dependabot[bot]`, a colleague); pull requests only (D47). */
  author?: string;
  /** Where someone else's pull request stands on GitHub, from the last poll (D47). */
  prStatus?: PrStatus;
  /**
   * The user's per-item choice to let the daemon merge someone else's pull request once it is ready
   * (D47). Absent: the repository's `autoMerge` setting decides.
   */
  autoMerge?: boolean;
  /**
   * The pull request's head and merge state when an automatic merge last failed for a reason that
   * passes (D47, e.g. the branch was behind its base). Auto-merge stays on but waits until either
   * changed, so the same refusal is not tried on every poll.
   */
  autoMergeHeld?: { head?: string; mergeState?: string };
  state: ItemState;
  /** Playbook name. */
  playbook: string;
  /** `issuePriority`: the "Priority" issue field, else the labels (D45). 0 is the most urgent. Recomputed on every poll. */
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
  /**
   * The coding agent that runs the item (issue #136). Set by the first start and then kept: a session
   * belongs to one agent. Absent: not started yet, or started before #136 (Claude Code, `agentOf`).
   */
  agentKind?: AgentKind;
  /** The agent's session id (Claude `session_id`), for a resume; it belongs to `agentKind`. */
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
