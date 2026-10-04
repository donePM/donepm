import { InvalidTransitionError, PlaybookNotAllowedError, playbookChanged, type Ctx, type WorkItem } from "@donepm/core";
import type { ItemWriter } from "./commit.js";
import type { ItemStore } from "./store.js";

export class PlaybookChangeError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "PlaybookChangeError";
  }
}

/** The playbooks an item's repository can load, and those it offers the item's ingest (issue #153). */
export interface ItemPlaybooks {
  available: string[];
  allowed: string[];
}

export interface PlaybookChangeDeps {
  items: ItemStore;
  writer: ItemWriter;
  ctx: Ctx;
  playbooks: (item: WorkItem) => Promise<ItemPlaybooks>;
}

/**
 * The playbook dropdown on a Ready card (spec 12.1). A name the repository cannot load is a 400;
 * one it does not offer for the item's ingest (issue #153) or a started item is a 409.
 */
export async function changePlaybook(deps: PlaybookChangeDeps, itemId: string, playbook: string): Promise<WorkItem> {
  const stored = deps.items.get(itemId);
  if (!stored) throw new PlaybookChangeError(404, "item not found");
  const { available, allowed } = await deps.playbooks(stored.item);
  if (!available.includes(playbook)) throw new PlaybookChangeError(400, `playbook "${playbook}" not found`);
  // Re-read: the item may have started while the playbooks loaded.
  const current = deps.items.get(itemId)?.item ?? stored.item;
  if (current.playbook === playbook) return current;
  try {
    return deps.writer.commit(playbookChanged(current, deps.ctx, playbook, allowed));
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new PlaybookChangeError(409, "the playbook can only change before the first start");
    if (e instanceof PlaybookNotAllowedError) throw new PlaybookChangeError(409, e.message);
    throw e;
  }
}
