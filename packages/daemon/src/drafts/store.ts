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

export class DraftStore {
  constructor(private readonly db: Db) {}

  forItem(itemId: string): Draft[] {
    const rows = this.db.prepare("SELECT * FROM drafts WHERE item_id = ? ORDER BY created_at, rowid").all(itemId) as unknown as DraftRow[];
    return rows.map(fromRow);
  }

  get(id: string): Draft | undefined {
    const row = this.db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as DraftRow | undefined;
    return row && fromRow(row);
  }

  pending(itemId: string): Draft[] {
    return this.forItem(itemId).filter((d) => d.state === "pending");
  }

  inState(state: DraftState): Draft[] {
    const rows = this.db.prepare("SELECT * FROM drafts WHERE state = ? ORDER BY created_at, rowid").all(state) as unknown as DraftRow[];
    return rows.map(fromRow);
  }

  insert(draft: Draft, at: string): void {
    this.db
      .prepare(
        "INSERT INTO drafts (id, item_id, type, payload, state, user_edits, result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        draft.id, draft.itemId, draft.type, JSON.stringify(draft.payload), draft.state,
        draft.userEdits ? JSON.stringify(draft.userEdits) : null,
        draft.result ? JSON.stringify(draft.result) : null,
        at, at,
      );
  }

  setState(id: string, state: DraftState, at: string): void {
    this.db.prepare("UPDATE drafts SET state = ?, updated_at = ? WHERE id = ?").run(state, at, id);
  }

  /** Executed: the draft's result is stored with it. */
  setResult(id: string, result: NonNullable<Draft["result"]>, at: string): void {
    this.db.prepare("UPDATE drafts SET state = 'executed', result = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(result), at, id);
  }

  setUserEdits(id: string, edits: Draft["payload"], at: string): void {
    this.db.prepare("UPDATE drafts SET user_edits = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(edits), at, id);
  }
}
