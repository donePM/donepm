import { InvalidTransitionError, playbookChanged, type Ctx, type WorkItem } from "@donepm/core";
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

export interface PlaybookChangeDeps {
  items: ItemStore;
  writer: ItemWriter;
  ctx: Ctx;
  /** Names of the playbooks the item's repository can use: global ones and its own. */
  available: (item: WorkItem) => Promise<string[]>;
}

/** The playbook dropdown on a Ready card (spec 12.1). Only names that exist for the repository. */
export async function changePlaybook(deps: PlaybookChangeDeps, itemId: string, playbook: string): Promise<WorkItem> {
  const stored = deps.items.get(itemId);
  if (!stored) throw new PlaybookChangeError(404, "item not found");
  if (!(await deps.available(stored.item)).includes(playbook)) throw new PlaybookChangeError(400, `playbook "${playbook}" not found`);
  // Re-read: the item may have started while the playbooks loaded.
  const current = deps.items.get(itemId)?.item ?? stored.item;
  if (current.playbook === playbook) return current;
  try {
    return deps.writer.commit(playbookChanged(current, deps.ctx, playbook));
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new PlaybookChangeError(409, "the playbook can only change before the first start");
    throw e;
  }
}
