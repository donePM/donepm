import type { WorkItem } from "@donepm/core";
import type { Db } from "../db/database.js";

/**
 * What is left of a purged item (D37): enough to keep the poll from importing its issue again.
 * `closed` is whether the issue was confirmed closed upstream. A closed issue that shows up in the
 * poll again was reopened and is imported fresh; an open one was finished and is skipped.
 */
export interface Tombstone {
  externalId: string;
  source: WorkItem["source"];
  originUrl: string;
  closed: boolean;
  deletedAt: string;
}

interface TombstoneRow {
  external_id: string;
  source: string;
  origin_url: string;
  closed: number;
  deleted_at: string;
}

const fromRow = (r: TombstoneRow): Tombstone => ({
  externalId: r.external_id,
  source: r.source as WorkItem["source"],
  originUrl: r.origin_url,
  closed: r.closed === 1,
  deletedAt: r.deleted_at,
});

export class TombstoneStore {
  constructor(private readonly db: Db) {}

  get(externalId: string): Tombstone | undefined {
    const row = this.db.prepare("SELECT * FROM tombstones WHERE external_id = ?").get(externalId) as TombstoneRow | undefined;
    return row && fromRow(row);
  }

  /** Tombstones whose issue was not seen closed yet. */
  open(): Tombstone[] {
    return (this.db.prepare("SELECT * FROM tombstones WHERE closed = 0 ORDER BY deleted_at").all() as unknown as TombstoneRow[]).map(fromRow);
  }

  /** Replaces an older tombstone of the same issue. */
  put(t: Tombstone): void {
    this.db
      .prepare("INSERT OR REPLACE INTO tombstones (external_id, source, origin_url, closed, deleted_at) VALUES (?, ?, ?, ?, ?)")
      .run(t.externalId, t.source, t.originUrl, t.closed ? 1 : 0, t.deletedAt);
  }

  markClosed(externalId: string): void {
    this.db.prepare("UPDATE tombstones SET closed = 1 WHERE external_id = ?").run(externalId);
  }

  remove(externalId: string): void {
    this.db.prepare("DELETE FROM tombstones WHERE external_id = ?").run(externalId);
  }
}
