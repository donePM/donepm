import type { Event, EventActor, EventType } from "@donepm/core";
import type { Db } from "../db/database.js";

interface EventRow {
  id: string;
  item_id: string;
  at: string;
  actor: string;
  type: string;
  payload: string;
  ref_id: string | null;
}

function fromRow(r: EventRow): Event {
  const e: Event = {
    id: r.id,
    itemId: r.item_id,
    at: r.at,
    actor: r.actor as EventActor,
    type: r.type as EventType,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
  };
  if (r.ref_id !== null) e.refId = r.ref_id;
  return e;
}

/** Append-only. There is deliberately no update or delete. */
export class EventStore {
  constructor(private readonly db: Db) {}

  append(events: readonly Event[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO events (id, item_id, at, actor, type, payload, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const e of events) {
      stmt.run(e.id, e.itemId, e.at, e.actor, e.type, JSON.stringify(e.payload), e.refId ?? null);
    }
  }

  /** In the order they were appended. */
  forItem(itemId: string): Event[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE item_id = ? ORDER BY seq").all(itemId) as unknown as EventRow[];
    return rows.map(fromRow);
  }
}
