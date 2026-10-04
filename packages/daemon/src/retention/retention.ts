import { archiveDue, archived, executedPr, finishedAt, purgeDue, type Ctx, type Retention } from "@donepm/core";
import type { AskStore } from "../asks/store.js";
import type { Db } from "../db/database.js";
import type { DraftStore } from "../drafts/store.js";
import type { EventStore } from "../events/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";
import { purgeItem } from "./purge.js";

export interface RetentionDeps {
  db: Db;
  items: ItemStore;
  events: EventStore;
  drafts: DraftStore;
  asks: AskStore;
  writer: ItemWriter;
  ctx: Ctx;
  log: Log;
  /** The user's `archiveAfterHours` and `deleteAfterDays`, read on every run. */
  retention: () => Retention;
}

export interface RetentionResult {
  archived: string[];
  purged: string[];
}

/**
 * Part of each poll, after the PR watch has recorded merges (D37). A finished item (done, and its
 * PR merged if a draft opened one) that has been finished for `archiveAfterHours` is archived:
 * an `item.archived` event and the flag, which takes it off the board. An item still waiting on a
 * draft or an ask stays. An archived item that has been archived for `deleteAfterDays` and has no
 * worktree is purged, logged here and not recorded as an event. Never throws for one item.
 */
export function applyRetention(deps: RetentionDeps): RetentionResult {
  const { items, ctx, log } = deps;
  const retention = deps.retention();
  const now = ctx.now();
  const result: RetentionResult = { archived: [], purged: [] };

  for (const { item, originUrl } of items.all()) {
    try {
      if (item.archivedAt === undefined) {
        if (item.state !== "done") continue;
        if (deps.drafts.pending(item.id).length > 0 || deps.asks.pending(item.id).length > 0) continue;
        const finished = finishedAt(item, deps.events.forItem(item.id), executedPr(deps.drafts.forItem(item.id)) !== undefined);
        if (finished === undefined || !archiveDue(finished, now, retention)) continue;
        deps.writer.commit(archived(item, ctx, finished));
        result.archived.push(item.id);
      } else if (purgeDue(item, now, retention)) {
        purgeItem(deps.db, item, originUrl, now);
        log.info({ itemId: item.id, externalId: item.externalId, archivedAt: item.archivedAt }, "purged archived item");
        result.purged.push(item.id);
      }
    } catch (e) {
      log.warn({ itemId: item.id, err: e }, "retention failed for item");
    }
  }
  return result;
}
