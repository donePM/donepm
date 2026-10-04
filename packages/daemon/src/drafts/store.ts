import type {
  CommentDraftResult, Draft, DraftState, PrDraft, PrDraftPayload, PrDraftResult, PushDraftResult, ReviewDraftResult, TicketCommentDraftResult,
  TicketTransitionDraftResult, UpdateBranchDraftResult,
} from "@donepm/core";

export type DraftResult =
  | PrDraftResult | PushDraftResult | CommentDraftResult | ReviewDraftResult | UpdateBranchDraftResult | TicketCommentDraftResult | TicketTransitionDraftResult;
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
  const base = { id: r.id, itemId: r.item_id, state: r.state as DraftState };
  const result: unknown = r.result === null ? undefined : JSON.parse(r.result);
  if (r.type === "comment") {
    return { ...base, type: "comment", payload: JSON.parse(r.payload), ...(result ? { result: result as CommentDraftResult } : {}) };
  }
  if (r.type === "review") {
    return { ...base, type: "review", payload: JSON.parse(r.payload), ...(result ? { result: result as ReviewDraftResult } : {}) };
  }
  if (r.type === "update_branch") {
    return { ...base, type: "update_branch", payload: JSON.parse(r.payload), ...(result ? { result: result as UpdateBranchDraftResult } : {}) };
  }
  if (r.type === "ticket_comment") {
    return { ...base, type: "ticket_comment", payload: JSON.parse(r.payload), ...(result ? { result: result as TicketCommentDraftResult } : {}) };
  }
  if (r.type === "ticket_transition") {
    return { ...base, type: "ticket_transition", payload: JSON.parse(r.payload), ...(result ? { result: result as TicketTransitionDraftResult } : {}) };
  }
  if (r.type === "push") {
    return { ...base, type: "push", payload: JSON.parse(r.payload), ...(result ? { result: result as PushDraftResult } : {}) };
  }
  const d: PrDraft = { ...base, type: "pr", payload: JSON.parse(r.payload) as PrDraftPayload };
  if (r.user_edits !== null) d.userEdits = JSON.parse(r.user_edits) as PrDraftPayload;
  if (result) d.result = result as PrDraftResult;
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
        draft.type === "pr" && draft.userEdits ? JSON.stringify(draft.userEdits) : null,
        draft.result ? JSON.stringify(draft.result) : null,
        at, at,
      );
  }

  setState(id: string, state: DraftState, at: string): void {
    this.db.prepare("UPDATE drafts SET state = ?, updated_at = ? WHERE id = ?").run(state, at, id);
  }

  /** Executed: the draft's result is stored with it. */
  setResult(id: string, result: DraftResult, at: string): void {
    this.db.prepare("UPDATE drafts SET state = 'executed', result = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(result), at, id);
  }

  /** What an execution got done so far, e.g. the replies already posted, so a retry skips them (D39). */
  setProgress(id: string, result: DraftResult, at: string): void {
    this.db.prepare("UPDATE drafts SET result = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(result), at, id);
  }

  setUserEdits(id: string, edits: PrDraftPayload, at: string): void {
    this.db.prepare("UPDATE drafts SET user_edits = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(edits), at, id);
  }
}
