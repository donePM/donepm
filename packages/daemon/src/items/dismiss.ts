import { InvalidTransitionError, dismissed, type Ctx, type WorkItem } from "@donepm/core";
import type { ItemWriter } from "./commit.js";
import type { ItemStore } from "./store.js";

export class DismissError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DismissError";
  }
}

/**
 * The user's Dismiss on an item whose issue was closed upstream (D32): it moves to Done. Refused
 * while its agent runs; the worktree stays for the user's Remove button.
 */
export function dismissItem(
  deps: { items: ItemStore; writer: ItemWriter; ctx: Ctx; agentActive: (itemId: string) => boolean },
  itemId: string,
): WorkItem {
  const stored = deps.items.get(itemId);
  if (!stored) throw new DismissError(404, "item not found");
  if (stored.item.closedUpstream !== true) throw new DismissError(409, "the issue is not closed upstream");
  if (deps.agentActive(itemId)) throw new DismissError(409, "stop the agent first");
  try {
    return deps.writer.commit(dismissed(stored.item, deps.ctx));
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new DismissError(409, `cannot dismiss a ${e.from} item`);
    throw e;
  }
}
