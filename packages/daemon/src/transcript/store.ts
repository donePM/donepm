import { isAgentKind, type TranscriptKind, type TranscriptMessage } from "@donepm/core";
import type { Db } from "../db/database.js";

interface TranscriptRow {
  id: string;
  item_id: string;
  session_id: string;
  at: string;
  kind: string;
  raw: string;
  agent_kind: string | null;
}

function fromRow(r: TranscriptRow): TranscriptMessage {
  return {
    id: r.id,
    itemId: r.item_id,
    sessionId: r.session_id,
    at: r.at,
    kind: r.kind as TranscriptKind,
    ...(r.agent_kind !== null && isAgentKind(r.agent_kind) ? { agentKind: r.agent_kind } : {}),
    raw: JSON.parse(r.raw) as unknown,
  };
}

export const TRANSCRIPT_PAGE = 500;

/** Agent conversation per item, in arrival order. Rows are only ever appended. */
export class TranscriptStore {
  constructor(private readonly db: Db) {}

  append(msg: TranscriptMessage): void {
    this.db
      .prepare("INSERT INTO transcript (id, item_id, session_id, at, kind, agent_kind, raw) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(msg.id, msg.itemId, msg.sessionId, msg.at, msg.kind, msg.agentKind ?? null, JSON.stringify(msg.raw));
  }

  /** Up to `limit` messages after the message `after` (exclusive), or from the start. */
  page(itemId: string, after?: string, limit = TRANSCRIPT_PAGE): TranscriptMessage[] {
    const rows = after
      ? this.db
          .prepare(
            `SELECT * FROM transcript WHERE item_id = ?
               AND seq > coalesce((SELECT seq FROM transcript WHERE id = ? AND item_id = ?), -1)
             ORDER BY seq LIMIT ?`,
          )
          .all(itemId, after, itemId, limit)
      : this.db.prepare("SELECT * FROM transcript WHERE item_id = ? ORDER BY seq LIMIT ?").all(itemId, limit);
    return (rows as unknown as TranscriptRow[]).map(fromRow);
  }
}
