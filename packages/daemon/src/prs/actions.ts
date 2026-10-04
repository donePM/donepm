import {
  conflictFixPrompt, feedbackFixPrompt, InvalidTransitionError, prConflictDismissed, prConflictFix, prConflictOf, prFeedbackDismissed,
  prFeedbackFix, prFeedbackOf,
  type Ctx, type PrConflict, type PrFeedback, type WorkItem,
} from "@donepm/core";
import type { ResumeHow } from "../agent/start.js";
import type { EventStore } from "../events/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Exec } from "../process/exec.js";
import type { RepoStore } from "../repos/store.js";

export class PrActionError extends Error {
  constructor(
    readonly status: 404 | 409 | 502,
    message: string,
  ) {
    super(message);
    this.name = "PrActionError";
  }
}

export interface PrActionDeps {
  items: ItemStore;
  events: EventStore;
  writer: ItemWriter;
  ctx: Ctx;
}

function waitingConflict(deps: PrActionDeps, itemId: string): { item: WorkItem; conflict: PrConflict } {
  const stored = deps.items.get(itemId);
  if (!stored) throw new PrActionError(404, "item not found");
  const conflict = prConflictOf(deps.events.forItem(itemId));
  if (stored.item.state !== "needs_you" || !conflict?.waiting) throw new PrActionError(409, "the item has no merge conflict to resolve");
  return { item: stored.item, conflict };
}

/**
 * "Resolve with agent" (decision D36): the daemon fetches the base and the PR branch, since the
 * agent has no network, then resumes the session with the conflict as the message. The merge reaches the PR as a push
 * draft the user approves.
 */
export async function resolveConflict<T>(
  deps: PrActionDeps & { exec: Exec; repos: RepoStore; resume: (itemId: string, how: ResumeHow) => Promise<T> },
  itemId: string,
): Promise<T> {
  const { item, conflict } = waitingConflict(deps, itemId);
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo || !item.worktreePath) throw new PrActionError(409, "the item has no worktree");
  if (!item.agentSessionId) throw new PrActionError(409, "the item has no agent session to resume");
  const refs = item.branch ? [conflict.base, item.branch] : [conflict.base];
  const fetched = await deps.exec("git", ["-C", repo.path, "fetch", "origin", ...refs], { timeoutMs: 5 * 60_000 });
  if (fetched.code !== 0) throw new PrActionError(502, fetched.stderr.trim() || `git fetch exited with ${fetched.code}`);
  return deps.resume(itemId, { transition: prConflictFix, prompt: conflictFixPrompt(conflict, item.branch) });
}

/** "I'll do it myself": the item goes back to where it was; the next poll that sees it mergeable clears it. */
export function dismissConflict(deps: PrActionDeps, itemId: string): WorkItem {
  const { item, conflict } = waitingConflict(deps, itemId);
  try {
    return deps.writer.commit(prConflictDismissed(item, deps.ctx, conflict));
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new PrActionError(409, `cannot do that with a ${e.from} item`);
    throw e;
  }
}

function waitingFeedback(deps: PrActionDeps, itemId: string): { item: WorkItem; feedback: PrFeedback } {
  const stored = deps.items.get(itemId);
  if (!stored) throw new PrActionError(404, "item not found");
  const feedback = prFeedbackOf(deps.events.forItem(itemId));
  if (stored.item.state !== "needs_you" || !feedback?.waiting) throw new PrActionError(409, "the item has no review feedback waiting");
  return { item: stored.item, feedback };
}

/**
 * "Address with agent" (decision D39): fetches the PR branch, since the agent has no network and
 * GitHub may have commits the worktree lacks (#121), then resumes the session with the feedback as
 * the message. Code changes reach the PR as a push draft, answers to reviewers as replies on a
 * draft, both approved by the user.
 */
export async function addressFeedback<T>(
  deps: PrActionDeps & { exec: Exec; repos: RepoStore; resume: (itemId: string, how: ResumeHow) => Promise<T> },
  itemId: string,
): Promise<T> {
  const { item, feedback } = waitingFeedback(deps, itemId);
  const repo = item.repoId ? deps.repos.get(item.repoId) : undefined;
  if (!repo || !item.worktreePath) throw new PrActionError(409, "the item has no worktree");
  if (!item.agentSessionId) throw new PrActionError(409, "the item has no agent session to resume");
  if (item.branch) {
    const fetched = await deps.exec("git", ["-C", repo.path, "fetch", "origin", item.branch], { timeoutMs: 5 * 60_000 });
    if (fetched.code !== 0) throw new PrActionError(502, fetched.stderr.trim() || `git fetch exited with ${fetched.code}`);
  }
  return deps.resume(itemId, { transition: prFeedbackFix, prompt: feedbackFixPrompt(feedback, item.branch) });
}

/** "Mark done": the user deals with the feedback, or it needs nothing. The item is done again. */
export function dismissFeedback(deps: PrActionDeps, itemId: string): WorkItem {
  const { item, feedback } = waitingFeedback(deps, itemId);
  try {
    return deps.writer.commit(prFeedbackDismissed(item, deps.ctx, feedback));
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new PrActionError(409, `cannot do that with a ${e.from} item`);
    throw e;
  }
}
