import type { PermissionAsk, PermissionAskState } from "@donepm/core";
import type { Db } from "../db/database.js";

interface AskRow {
  id: string;
  item_id: string;
  request_id: string;
  tool_name: string;
  input: string;
  state: string;
}

function fromRow(r: AskRow): PermissionAsk {
  return {
    id: r.id,
    itemId: r.item_id,
    requestId: r.request_id,
    toolName: r.tool_name,
    input: JSON.parse(r.input) as unknown,
    state: r.state as PermissionAskState,
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

  pending(itemId: string): PermissionAsk[] {
    return this.forItem(itemId).filter((a) => a.state === "pending");
  }

  insert(ask: PermissionAsk, at: string): void {
    this.db
      .prepare(
        "INSERT INTO asks (id, item_id, request_id, tool_name, input, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(ask.id, ask.itemId, ask.requestId, ask.toolName, JSON.stringify(ask.input), ask.state, at, at);
  }

  setState(id: string, state: PermissionAskState, at: string): void {
    this.db.prepare("UPDATE asks SET state = ?, updated_at = ? WHERE id = ?").run(state, at, id);
  }
}
