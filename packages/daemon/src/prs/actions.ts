import {
  conflictFixPrompt, InvalidTransitionError, prConflictDismissed, prConflictFix, prConflictOf,
  type Ctx, type PrConflict, type WorkItem,
} from "@donepm/core";
import type { ResumeHow } from "../agent/start.js";
import type { EventStore } from "../events/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Exec } from "../process/exec.js";
import type { RepoStore } from "../repos/store.js";

export class ConflictActionError extends Error {
  constructor(
    readonly status: 404 | 409 | 502,
    message: string,
  ) {
    super(message);
    this.name = "ConflictActionError";
  }
}

export interface ConflictActionDeps {
  items: ItemStore;
  events: EventStore;
  writer: ItemWriter;
  ctx: Ctx;
}

function waitingConflict(deps: ConflictActionDeps, itemId: string): { item: WorkItem; conflict: PrConflict } {
  const stored = deps.items.get(itemId);
  if (!stored) throw new ConflictActionError(404, "item not found");
  const conflict = prConflictOf(deps.events.forItem(itemId));
  if (stored.item.state !== "needs_you" || !conflict?.waiting) throw new ConflictActionError(409, "the item has no merge conflict to resolve");
  return { item: stored.item, conflict };
}

/**
 * "Resolve with agent" (decision D36): the daemon fetches the base, since the agent has no network,
 * then resumes the session with the conflict as the message. The merge reaches the PR as a push
 * draft the user approves.
 */
export async function resolveConflict<T>(
  deps: ConflictActionDeps & { exec: Exec; repos: RepoStore; resume: (itemId: string, how: ResumeHow) => Promise<T> },
  itemId: string,
): Promise<T> {
  const { item, conflict } = waitingConflict(deps, itemId);
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo || !item.worktreePath) throw new ConflictActionError(409, "the item has no worktree");
  if (!item.agentSessionId) throw new ConflictActionError(409, "the item has no agent session to resume");
  const fetched = await deps.exec("git", ["-C", repo.path, "fetch", "origin", conflict.base], { timeoutMs: 5 * 60_000 });
  if (fetched.code !== 0) throw new ConflictActionError(502, fetched.stderr.trim() || `git fetch exited with ${fetched.code}`);
  return deps.resume(itemId, { transition: prConflictFix, prompt: conflictFixPrompt(conflict) });
}

/** "I'll do it myself": the item goes back to where it was; the next poll that sees it mergeable clears it. */
export function dismissConflict(deps: ConflictActionDeps, itemId: string): WorkItem {
  const { item, conflict } = waitingConflict(deps, itemId);
  try {
    return deps.writer.commit(prConflictDismissed(item, deps.ctx, conflict));
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new ConflictActionError(409, `cannot do that with a ${e.from} item`);
    throw e;
  }
}
