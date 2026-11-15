import { InvalidTransitionError, linkRepo, NotARepoCandidateError, repoChosen, type Ctx, type WorkItem } from "@donepm/core";
import type { RepoStore } from "../repos/store.js";
import type { ItemWriter } from "./commit.js";
import type { ItemStore } from "./store.js";

export class RepoChoiceError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "RepoChoiceError";
  }
}

/**
 * The user picks which repository a ticket of several goes to (issue #139): an `item.repo_chosen`
 * event, and the item is linked to that repository's clone, if there is one. It can change its
 * mind until the agent first starts.
 */
export function chooseRepo(
  deps: { items: ItemStore; repos: RepoStore; writer: ItemWriter; ctx: Ctx },
  itemId: string,
  origin: string,
): WorkItem {
  const stored = deps.items.get(itemId);
  if (!stored) throw new RepoChoiceError(404, "item not found");
  try {
    const t = repoChosen(stored.item, deps.ctx, origin);
    if (t.events.length === 0) return stored.item;
    const linked = linkRepo(t.item, deps.repos.byOrigin(origin)?.id, deps.ctx) ?? t.item;
    return deps.writer.commit({ item: linked, events: t.events });
  } catch (e) {
    if (e instanceof NotARepoCandidateError) throw new RepoChoiceError(400, e.message);
    if (e instanceof InvalidTransitionError) throw new RepoChoiceError(409, "the repository is fixed once the agent has started");
    throw e;
  }
}
