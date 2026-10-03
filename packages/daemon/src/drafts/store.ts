import type { Draft, DraftState, DraftType } from "@donepm/core";
import type { Db } from "../db/database.js";

interface DraftRow {
  id: string;
  item_id: string;
  type: string;
  payload: string;
  state: string;
  user_edits: string | null;
  result: string | null;
}

function fromRow(r: DraftRow): Draft {
  const d: Draft = {
    id: r.id,
    itemId: r.item_id,
    type: r.type as DraftType,
    payload: JSON.parse(r.payload) as Draft["payload"],
    state: r.state as DraftState,
  };
  if (r.user_edits !== null) d.userEdits = JSON.parse(r.user_edits) as Draft["payload"];
  if (r.result !== null) d.result = JSON.parse(r.result) as NonNullable<Draft["result"]>;
  return d;
}

/** Read side only for now; drafts are written once the MCP server exists. */
export class DraftStore {
  constructor(private readonly db: Db) {}

  forItem(itemId: string): Draft[] {
    const rows = this.db.prepare("SELECT * FROM drafts WHERE item_id = ? ORDER BY created_at").all(itemId) as unknown as DraftRow[];
    return rows.map(fromRow);
  }
}
