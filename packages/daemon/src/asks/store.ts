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

/** Read side only for now; asks are written once the agent runner exists. */
export class AskStore {
  constructor(private readonly db: Db) {}

  forItem(itemId: string): PermissionAsk[] {
    const rows = this.db.prepare("SELECT * FROM asks WHERE item_id = ? ORDER BY created_at").all(itemId) as unknown as AskRow[];
    return rows.map(fromRow);
  }
}
