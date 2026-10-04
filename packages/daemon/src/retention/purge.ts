import type { WorkItem } from "@donepm/core";
import { transaction, type Db } from "../db/database.js";
import { TombstoneStore } from "./tombstones.js";

/**
 * Delete an archived item with everything that belongs to it: transcript (with its raw lines),
 * asks, drafts, events and the item row, and leave a tombstone (D37). One transaction. The events
 * table lets this through only for archived items; the purge is the one place that deletes events.
 */
export function purgeItem(db: Db, item: WorkItem, originUrl: string, at: string): void {
  if (item.archivedAt === undefined) throw new Error(`item ${item.id} is not archived`);
  transaction(db, () => {
    for (const table of ["transcript", "asks", "drafts", "events"]) {
      db.prepare(`DELETE FROM ${table} WHERE item_id = ?`).run(item.id);
    }
    db.prepare("DELETE FROM items WHERE id = ?").run(item.id);
    new TombstoneStore(db).put({
      externalId: item.externalId,
      source: item.source,
      originUrl,
      closed: item.closedUpstream === true,
      deletedAt: at,
    });
  });
}
