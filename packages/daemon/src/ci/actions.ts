import {
  ciFailureOf, ciFix, ciFixPrompt, ciMarkedDone, ciRerun, InvalidTransitionError,
  type CiFailure, type Ctx, type Transition, type WorkItem,
} from "@donepm/core";
import type { ResumeHow } from "../agent/start.js";
import type { EventStore } from "../events/store.js";
import { prRepository } from "../gh/pr-state.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Exec } from "../process/exec.js";

export class CiActionError extends Error {
  constructor(
    readonly status: 404 | 409 | 502,
    message: string,
  ) {
    super(message);
    this.name = "CiActionError";
  }
}

export interface CiActionDeps {
  items: ItemStore;
  events: EventStore;
  writer: ItemWriter;
  ctx: Ctx;
}

function failureOf(deps: CiActionDeps, itemId: string): { item: WorkItem; failure: CiFailure } {
  const stored = deps.items.get(itemId);
  if (!stored) throw new CiActionError(404, "item not found");
  const failure = ciFailureOf(deps.events.forItem(itemId));
  if (stored.item.state !== "needs_you" || !failure) throw new CiActionError(409, "the item has no red CI");
  return { item: stored.item, failure };
}

/**
 * The user's "Rerun failed jobs" on a red CI (decision D35): `gh run rerun --failed` for each run a
 * failed check belongs to, then the item waits for CI again. The user's click is the approval.
 */
export async function rerunCi(deps: CiActionDeps & { exec: Exec }, itemId: string): Promise<WorkItem> {
  const { item, failure } = failureOf(deps, itemId);
  const repository = failure.pr && prRepository(failure.pr.url);
  if (!failure.pr || !repository) throw new CiActionError(409, "the failure names no pull request");
  if (failure.runs.length === 0) throw new CiActionError(409, "no failed check belongs to a GitHub Actions run");
  for (const run of failure.runs) {
    const r = await deps.exec("gh", ["run", "rerun", run, "--failed", "--repo", repository]);
    if (r.code !== 0) throw new CiActionError(502, r.stderr.trim() || `gh run rerun exited with ${r.code}`);
  }
  const now = deps.items.get(itemId)?.item ?? item;
  return commit(deps, () => ciRerun(now, deps.ctx, failure.pr!, failure.runs));
}

/** The user's "Mark done" while CI runs or after it failed: the item moves to Done as it is. */
export function markCiDone(deps: CiActionDeps & { agentActive: (itemId: string) => boolean }, itemId: string): WorkItem {
  const stored = deps.items.get(itemId);
  if (!stored) throw new CiActionError(404, "item not found");
  const { item } = stored;
  if (item.state === "needs_you" && !ciFailureOf(deps.events.forItem(itemId))) throw new CiActionError(409, "the item has no red CI");
  if (deps.agentActive(itemId)) throw new CiActionError(409, "stop the agent first");
  return commit(deps, () => ciMarkedDone(item, deps.ctx));
}

/**
 * The user's "Fix with agent" on a red CI: resume the agent's session with the failed checks and
 * their log ends, since the agent cannot reach GitHub itself.
 */
export async function fixCi<T>(
  deps: CiActionDeps & { resume: (itemId: string, how: ResumeHow) => Promise<T> },
  itemId: string,
): Promise<T> {
  const { failure } = failureOf(deps, itemId);
  const prompt = ciFixPrompt({ ...(failure.pr ? { number: failure.pr.number } : {}), failed: failure.failed, logs: failure.logs });
  return deps.resume(itemId, { transition: ciFix, prompt });
}

function commit(deps: CiActionDeps, transition: () => Transition): WorkItem {
  try {
    return deps.writer.commit(transition());
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new CiActionError(409, `cannot do that with a ${e.from} item`);
    throw e;
  }
}
