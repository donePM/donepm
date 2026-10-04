import { sameRule, type PermissionGrant, type PermissionRule } from "@donepm/core";
import type { Db } from "../db/database.js";

interface GrantRow {
  id: string;
  repo: string;
  tool_name: string;
  rule_content: string | null;
  created_at: string;
  ask_id: string;
  item_id: string;
  call: string;
  use_count: number;
  last_used_at: string | null;
  revoked_at: string | null;
}

function fromRow(r: GrantRow): PermissionGrant {
  return {
    id: r.id,
    repo: r.repo,
    toolName: r.tool_name,
    ...(r.rule_content !== null ? { ruleContent: r.rule_content } : {}),
    createdAt: r.created_at,
    askId: r.ask_id,
    itemId: r.item_id,
    call: r.call,
    useCount: r.use_count,
    ...(r.last_used_at ? { lastUsedAt: r.last_used_at } : {}),
    ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
  };
}

/** "Always allow" grants per repository (D38). Rows are never deleted; a removal sets `revoked_at`. */
export class GrantStore {
  constructor(private readonly db: Db) {}

  /** Grants still in force, oldest first. Read on every ask, so a removal applies at once. */
  active(repo?: string): PermissionGrant[] {
    const rows = (
      repo === undefined
        ? this.db.prepare("SELECT * FROM permission_grants WHERE revoked_at IS NULL ORDER BY repo, created_at, rowid").all()
        : this.db.prepare("SELECT * FROM permission_grants WHERE revoked_at IS NULL AND repo = ? ORDER BY created_at, rowid").all(repo)
    ) as unknown as GrantRow[];
    return rows.map(fromRow);
  }

  get(id: string): PermissionGrant | undefined {
    const row = this.db.prepare("SELECT * FROM permission_grants WHERE id = ?").get(id) as GrantRow | undefined;
    return row && fromRow(row);
  }

  /**
   * Store a grant for the rule unless the repository has one in force already. Returns the new
   * grant, or undefined when nothing was added.
   */
  add(grant: { id: string; repo: string; rule: PermissionRule; askId: string; itemId: string; call: string }, at: string): PermissionGrant | undefined {
    if (this.active(grant.repo).some((g) => sameRule(g, grant.rule))) return undefined;
    this.db
      .prepare("INSERT INTO permission_grants (id, repo, tool_name, rule_content, created_at, ask_id, item_id, call) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(grant.id, grant.repo, grant.rule.toolName, grant.rule.ruleContent ?? null, at, grant.askId, grant.itemId, grant.call);
    return this.get(grant.id);
  }

  /** The grants answered an ask. */
  used(ids: readonly string[], at: string): void {
    const stmt = this.db.prepare("UPDATE permission_grants SET use_count = use_count + 1, last_used_at = ? WHERE id = ?");
    for (const id of ids) stmt.run(at, id);
  }

  /** Returns false when the grant was already revoked. */
  revoke(id: string, at: string): boolean {
    const r = this.db.prepare("UPDATE permission_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(at, id);
    return Number(r.changes) > 0;
  }
}
