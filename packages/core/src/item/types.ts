export type ItemSource = "github-issue";

export type ItemState = "ready" | "running" | "needs_you" | "done" | "failed";

export interface WorkItem {
  id: string;
  source: ItemSource;
  /** `owner/repo#123` */
  externalId: string;
  externalUrl: string;
  repoId: string;
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
  createdAt: string;
  updatedAt: string;
}
