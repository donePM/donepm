import type { Event, Transition, WorkItem } from "@donepm/core";
import { transaction, type Db } from "../db/database.js";
import type { EventStore } from "../events/store.js";
import type { ItemStore } from "./store.js";

export interface ItemWriter {
  /** Persist a core transition (item and its events together) and notify the UI. */
  commit(t: Transition): WorkItem;
  /** Persist field changes that are not a state transition (session id, worktree path). */
  save(item: WorkItem): WorkItem;
}

export function itemWriter(deps: {
  db: Db;
  items: ItemStore;
  events: EventStore;
  onItem: (item: WorkItem) => void;
  onEvent: (event: Event) => void;
}): ItemWriter {
  return {
    commit(t) {
      transaction(deps.db, () => {
        deps.items.update(t.item);
        deps.events.append(t.events);
      });
      for (const e of t.events) deps.onEvent(e);
      deps.onItem(t.item);
      return t.item;
    },
    save(item) {
      deps.items.update(item);
      deps.onItem(item);
      return item;
    },
  };
}
