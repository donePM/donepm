import { agentFailed, interrupted, type Ctx } from "@donepm/core";
import type { AskStore } from "../asks/store.js";
import type { ItemWriter } from "../items/commit.js";
import type { ItemStore } from "../items/store.js";
import type { Log } from "../log.js";

export const RESTART_REASON = "daemon restarted";

/**
 * On start no agent process exists (spec 9.5). Items left mid-turn (running, or waiting on a
 * permission question) wait for the user to resume their session; without a session the agent
 * never really started, so they fail and can be retried. The pending questions expire: the
 * process that asked is gone.
 */
export function recoverAfterRestart(deps: { items: ItemStore; asks: AskStore; writer: ItemWriter; ctx: Ctx; log: Log }): void {
  const asked = new Set<string>();
  for (const ask of deps.asks.inState("pending")) {
    deps.asks.setState(ask.id, "expired", deps.ctx.now());
    asked.add(ask.itemId);
  }
  for (const { item } of deps.items.all()) {
    if (item.state !== "running" && !(item.state === "needs_you" && asked.has(item.id))) continue;
    deps.writer.commit(
      item.agentSessionId
        ? interrupted(item, deps.ctx, RESTART_REASON)
        : agentFailed(item, deps.ctx, "donePM restarted before the agent started"),
    );
    deps.log.info({ itemId: item.id }, "agent interrupted by restart");
  }
}
