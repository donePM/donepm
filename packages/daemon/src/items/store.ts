import type { ItemState, WorkItem } from "@donepm/core";
import type { Db } from "../db/database.js";

interface ItemRow {
  id: string;
  source: string;
  external_id: string;
  external_url: string;
  origin_url: string;
  repo_id: string | null;
  title: string;
  body: string;
  labels: string;
  state: string;
  playbook: string;
  priority: number;
  issue_created_at: string | null;
  started_at: string | null;
  state_since: string;
  worktree_path: string | null;
  branch: string | null;
  base_branch: string | null;
  author: string | null;
  pr_status: string | null;
  auto_merge: number | null;
  auto_merge_held: string | null;
  agent_session_id: string | null;
  closed_upstream: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** A stored item plus the normalised origin of its repository, used to match a local clone. */
export interface StoredItem {
  item: WorkItem;
  originUrl: string;
}

function fromRow(r: ItemRow): StoredItem {
  const item: WorkItem = {
    id: r.id,
    source: r.source as WorkItem["source"],
    externalId: r.external_id,
    externalUrl: r.external_url,
    title: r.title,
    body: r.body,
    labels: JSON.parse(r.labels) as string[],
    state: r.state as ItemState,
    playbook: r.playbook,
    priority: r.priority,
    stateSince: r.state_since,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.repo_id !== null) item.repoId = r.repo_id;
  if (r.issue_created_at !== null) item.issueCreatedAt = r.issue_created_at;
  if (r.started_at !== null) item.startedAt = r.started_at;
  if (r.worktree_path !== null) item.worktreePath = r.worktree_path;
  if (r.branch !== null) item.branch = r.branch;
  if (r.base_branch !== null) item.baseBranch = r.base_branch;
  if (r.author !== null) item.author = r.author;
  if (r.pr_status !== null) item.prStatus = JSON.parse(r.pr_status) as WorkItem["prStatus"];
  if (r.auto_merge !== null) item.autoMerge = r.auto_merge === 1;
  if (r.auto_merge_held !== null) item.autoMergeHeld = JSON.parse(r.auto_merge_held) as WorkItem["autoMergeHeld"];
  if (r.agent_session_id !== null) item.agentSessionId = r.agent_session_id;
  if (r.closed_upstream) item.closedUpstream = true;
  if (r.archived_at !== null) item.archivedAt = r.archived_at;
  return { item, originUrl: r.origin_url };
}

function params(item: WorkItem) {
  return {
    id: item.id,
    source: item.source,
    external_id: item.externalId,
    external_url: item.externalUrl,
    repo_id: item.repoId ?? null,
    title: item.title,
    body: item.body,
    labels: JSON.stringify(item.labels),
    state: item.state,
    playbook: item.playbook,
    priority: item.priority,
    issue_created_at: item.issueCreatedAt ?? null,
    started_at: item.startedAt ?? null,
    state_since: item.stateSince,
    worktree_path: item.worktreePath ?? null,
    branch: item.branch ?? null,
    base_branch: item.baseBranch ?? null,
    author: item.author ?? null,
    pr_status: item.prStatus ? JSON.stringify(item.prStatus) : null,
    auto_merge: item.autoMerge === undefined ? null : item.autoMerge ? 1 : 0,
    auto_merge_held: item.autoMergeHeld ? JSON.stringify(item.autoMergeHeld) : null,
    agent_session_id: item.agentSessionId ?? null,
    closed_upstream: item.closedUpstream ? 1 : 0,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    archived_at: item.archivedAt ?? null,
  };
}

/** Items are deleted only by the retention purge (D37, `retention/purge.ts`), never here. */
export class ItemStore {
  constructor(private readonly db: Db) {}

  /** Live and archived items. */
  all(): StoredItem[] {
    const rows = this.db.prepare("SELECT * FROM items ORDER BY priority, created_at").all() as unknown as ItemRow[];
    return rows.map(fromRow);
  }

  /** Archived items, the most recently archived first (D37). */
  archived(): StoredItem[] {
    const rows = this.db
      .prepare("SELECT * FROM items WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, created_at DESC")
      .all() as unknown as ItemRow[];
    return rows.map(fromRow);
  }

  get(id: string): StoredItem | undefined {
    const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
    return row && fromRow(row);
  }

  /** The live (not archived) item of an issue; there is at most one. */
  byExternalId(externalId: string): StoredItem | undefined {
    const row = this.db
      .prepare("SELECT * FROM items WHERE external_id = ? AND archived_at IS NULL")
      .get(externalId) as ItemRow | undefined;
    return row && fromRow(row);
  }

  /** The most recently archived item of an issue. */
  latestArchived(externalId: string): StoredItem | undefined {
    const row = this.db
      .prepare("SELECT * FROM items WHERE external_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT 1")
      .get(externalId) as ItemRow | undefined;
    return row && fromRow(row);
  }

  insert(item: WorkItem, originUrl: string): void {
    this.db
      .prepare(
        `INSERT INTO items (id, source, external_id, external_url, origin_url, repo_id, title, body, labels, state,
           playbook, priority, issue_created_at, started_at, state_since, worktree_path, branch, base_branch, author, pr_status, auto_merge, auto_merge_held, agent_session_id,
           closed_upstream, created_at, updated_at, archived_at)
         VALUES (:id, :source, :external_id, :external_url, :origin_url, :repo_id, :title, :body, :labels, :state,
           :playbook, :priority, :issue_created_at, :started_at, :state_since, :worktree_path, :branch, :base_branch, :author, :pr_status, :auto_merge, :auto_merge_held, :agent_session_id,
           :closed_upstream, :created_at, :updated_at, :archived_at)`,
      )
      .run({ ...params(item), origin_url: originUrl });
  }

  update(item: WorkItem): void {
    const { external_id: _ignored, created_at: _created, ...p } = params(item);
    this.db
      .prepare(
        `UPDATE items SET source = :source, external_url = :external_url, repo_id = :repo_id, title = :title,
           body = :body, labels = :labels, state = :state, playbook = :playbook, priority = :priority,
           issue_created_at = :issue_created_at, started_at = :started_at, state_since = :state_since, worktree_path = :worktree_path, branch = :branch, base_branch = :base_branch, author = :author, pr_status = :pr_status, auto_merge = :auto_merge, auto_merge_held = :auto_merge_held, agent_session_id = :agent_session_id,
           closed_upstream = :closed_upstream, updated_at = :updated_at, archived_at = :archived_at
         WHERE id = :id`,
      )
      .run(p);
  }
}
