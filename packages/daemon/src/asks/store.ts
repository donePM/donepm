import { offerableRules, parseRules, type PermissionAsk, type PermissionAskState } from "@donepm/core";
import type { Db } from "../db/database.js";

interface AskRow {
  id: string;
  item_id: string;
  request_id: string;
  tool_name: string;
  input: string;
  state: string;
  rules: string;
  reason: string | null;
  outcome_reason: string | null;
}

function fromRow(r: AskRow): PermissionAsk {
  return {
    id: r.id,
    itemId: r.item_id,
    requestId: r.request_id,
    toolName: r.tool_name,
    input: JSON.parse(r.input) as unknown,
    state: r.state as PermissionAskState,
    rules: parseRules(JSON.parse(r.rules) as unknown),
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.outcome_reason ? { outcomeReason: r.outcome_reason } : {}),
  };
}

export class AskStore {
  constructor(private readonly db: Db) {}

  forItem(itemId: string): PermissionAsk[] {
    const rows = this.db.prepare("SELECT * FROM asks WHERE item_id = ? ORDER BY created_at, rowid").all(itemId) as unknown as AskRow[];
    return rows.map(fromRow);
  }

  get(id: string): PermissionAsk | undefined {
    const row = this.db.prepare("SELECT * FROM asks WHERE id = ?").get(id) as AskRow | undefined;
    return row && fromRow(row);
  }

  inState(state: PermissionAskState): PermissionAsk[] {
    const rows = this.db.prepare("SELECT * FROM asks WHERE state = ? ORDER BY created_at, rowid").all(state) as unknown as AskRow[];
    return rows.map(fromRow);
  }

  pending(itemId: string): PermissionAsk[] {
    return this.forItem(itemId).filter((a) => a.state === "pending");
  }

  /** Stores only the rules that may be granted; a rule the deny list forbids is never kept. */
  insert(ask: PermissionAsk, at: string): void {
    this.db
      .prepare(
        "INSERT INTO asks (id, item_id, request_id, tool_name, input, state, rules, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        ask.id, ask.itemId, ask.requestId, ask.toolName, JSON.stringify(ask.input), ask.state, JSON.stringify(offerableRules(ask.rules)),
        ask.reason ?? null, at, at,
      );
  }

  setState(id: string, state: PermissionAskState, at: string, outcomeReason?: string): void {
    this.db
      .prepare("UPDATE asks SET state = ?, outcome_reason = coalesce(?, outcome_reason), updated_at = ? WHERE id = ?")
      .run(state, outcomeReason ?? null, at, id);
  }
}
