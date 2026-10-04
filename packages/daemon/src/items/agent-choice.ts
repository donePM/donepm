import { InvalidTransitionError, agentKindChanged, type AgentKind, type Ctx, type WorkItem } from "@donepm/core";
import type { ItemWriter } from "./commit.js";
import type { ItemStore } from "./store.js";

export class AgentChangeError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AgentChangeError";
  }
}

export interface AgentChangeDeps {
  items: ItemStore;
  writer: ItemWriter;
  ctx: Ctx;
  isRunning: (itemId: string) => boolean;
}

/**
 * The agent dropdown on a Ready or Failed card (issue #137). Another agent drops the item's session,
 * since a session belongs to the agent that made it; the next start begins a fresh one (D49).
 */
export async function changeAgent(deps: AgentChangeDeps, itemId: string, agent: AgentKind): Promise<WorkItem> {
  const item = deps.items.get(itemId)?.item;
  if (!item) throw new AgentChangeError(404, "item not found");
  if (deps.isRunning(itemId)) throw new AgentChangeError(409, "the agent is still running");
  try {
    return deps.writer.commit(agentKindChanged(item, deps.ctx, agent));
  } catch (e) {
    if (e instanceof InvalidTransitionError) throw new AgentChangeError(409, "the agent can only change on a Ready or Failed item");
    throw e;
  }
}
