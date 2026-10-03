export type ItemSource = "github-issue";

export type ItemState = "ready" | "running" | "needs_you" | "done" | "failed";

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
  priority: number;
  worktreePath?: string;
  branch?: string;
  /** Claude `session_id`, for `--resume`. */
  agentSessionId?: string;
  /** The issue was closed upstream while the item was not done. */
  closedUpstream?: boolean;
  createdAt: string;
  updatedAt: string;
}
