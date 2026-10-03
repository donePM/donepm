import type { Event } from "@donepm/core";

/** What the board and the Agents view show about an item's agent, derived from its events. */
export interface AgentHistory {
  /** When the latest agent process started (`agent.started` or `agent.resumed`). */
  startedAt?: string;
  /** Total over all processes, from `result.total_cost_usd`. */
  costUsd?: number;
}

/**
 * `total_cost_usd` counts from the start of the `claude` process, so each process contributes its
 * last reported value, and a new process (start, resume) starts a new sum.
 */
export function agentHistory(events: readonly Event[]): AgentHistory {
  let startedAt: string | undefined;
  let closed = 0;
  let current: number | undefined;
  let seen = false;
  for (const e of events) {
    if (e.type === "agent.started" || e.type === "agent.resumed") {
      closed += current ?? 0;
      current = undefined;
      startedAt = e.at;
    } else if (e.type === "agent.turn_ended" && typeof e.payload.costUsd === "number") {
      current = e.payload.costUsd;
      seen = true;
    }
  }
  const out: AgentHistory = {};
  if (startedAt) out.startedAt = startedAt;
  if (seen) out.costUsd = closed + (current ?? 0);
  return out;
}
