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
  agent_session_id: string | null;
  closed_upstream: number;
  created_at: string;
  updated_at: string;
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
  if (r.agent_session_id !== null) item.agentSessionId = r.agent_session_id;
  if (r.closed_upstream) item.closedUpstream = true;
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
    agent_session_id: item.agentSessionId ?? null,
    closed_upstream: item.closedUpstream ? 1 : 0,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

/** Items are never deleted. */
export class ItemStore {
  constructor(private readonly db: Db) {}

  all(): StoredItem[] {
    const rows = this.db.prepare("SELECT * FROM items ORDER BY priority, created_at").all() as unknown as ItemRow[];
    return rows.map(fromRow);
  }

  get(id: string): StoredItem | undefined {
    const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
    return row && fromRow(row);
  }

  byExternalId(externalId: string): StoredItem | undefined {
    const row = this.db.prepare("SELECT * FROM items WHERE external_id = ?").get(externalId) as ItemRow | undefined;
    return row && fromRow(row);
  }

  insert(item: WorkItem, originUrl: string): void {
    this.db
      .prepare(
        `INSERT INTO items (id, source, external_id, external_url, origin_url, repo_id, title, body, labels, state,
           playbook, priority, issue_created_at, started_at, state_since, worktree_path, branch, agent_session_id,
           closed_upstream, created_at, updated_at)
         VALUES (:id, :source, :external_id, :external_url, :origin_url, :repo_id, :title, :body, :labels, :state,
           :playbook, :priority, :issue_created_at, :started_at, :state_since, :worktree_path, :branch, :agent_session_id,
           :closed_upstream, :created_at, :updated_at)`,
      )
      .run({ ...params(item), origin_url: originUrl });
  }

  update(item: WorkItem): void {
    const { external_id: _ignored, created_at: _created, ...p } = params(item);
    this.db
      .prepare(
        `UPDATE items SET source = :source, external_url = :external_url, repo_id = :repo_id, title = :title,
           body = :body, labels = :labels, state = :state, playbook = :playbook, priority = :priority,
           issue_created_at = :issue_created_at, started_at = :started_at, state_since = :state_since, worktree_path = :worktree_path, branch = :branch, agent_session_id = :agent_session_id,
           closed_upstream = :closed_upstream, updated_at = :updated_at
         WHERE id = :id`,
      )
      .run(p);
  }
}
