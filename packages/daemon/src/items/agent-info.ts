import type { Event } from "@donepm/core";

/** What the board and the Agents view show about an item's agent, derived from its events. */
export interface AgentHistory {
  /** When the latest agent process started (`agent.started` or `agent.resumed`). */
  startedAt?: string;
  /** Time the agent worked in closed intervals since the last fresh start; waiting on the user does not count. */
  elapsedMs?: number;
  /** Start of the interval the agent is working in now; the UI adds `now - activeSince` to `elapsedMs`. */
  activeSince?: string;
  /** Total over all processes, from `result.total_cost_usd`. */
  costUsd?: number;
}

/** Events after which the agent works again. */
const OPENS = new Set(["agent.started", "agent.resumed", "agent.turn_started", "permission.answered"]);
/** Events after which the agent waits on the user or no longer runs. */
const CLOSES = new Set(["agent.turn_ended", "permission.asked", "agent.interrupted", "agent.failed"]);

/**
 * `total_cost_usd` counts from the start of the `claude` process, so each process contributes its
 * last reported value, and a new process (start, resume) starts a new sum.
 *
 * Elapsed time is the sum of the intervals the agent worked. A resume continues the sum; a fresh
 * start (`agent.started`, a new session) begins at zero.
 */
export function agentHistory(events: readonly Event[]): AgentHistory {
  let startedAt: string | undefined;
  let closed = 0;
  let current: number | undefined;
  let seen = false;
  let elapsedMs = 0;
  let activeSince: string | undefined;
  for (const e of events) {
    if (e.type === "agent.started") elapsedMs = 0;
    if (e.type === "agent.started" || e.type === "agent.resumed") {
      closed += current ?? 0;
      current = undefined;
      startedAt = e.at;
    } else if (e.type === "agent.turn_ended" && typeof e.payload.costUsd === "number") {
      current = e.payload.costUsd;
      seen = true;
    }
    if (e.type === "agent.started") activeSince = e.at;
    else if (OPENS.has(e.type) && !(e.type === "permission.answered" && e.actor === "system" && e.payload.behavior === "deny")) activeSince ??= e.at;
    else if (CLOSES.has(e.type) && activeSince) {
      elapsedMs += Math.max(0, Date.parse(e.at) - Date.parse(activeSince));
      activeSince = undefined;
    }
  }
  const out: AgentHistory = {};
  if (startedAt) {
    out.startedAt = startedAt;
    out.elapsedMs = elapsedMs;
  }
  if (activeSince) out.activeSince = activeSince;
  if (seen) out.costUsd = closed + (current ?? 0);
  return out;
}

/** Only a live process ticks: an interval left open by a process that is gone is not counted. */
export function liveHistory(history: AgentHistory, running: boolean): AgentHistory {
  if (running || !history.activeSince) return history;
  const { activeSince: _, ...rest } = history;
  return rest;
}
