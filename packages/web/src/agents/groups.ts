import type { ItemView } from "../api/types";

export type AgentGroupKey = "running" | "waiting" | "finished";

export const AGENT_GROUPS: { key: AgentGroupKey; title: string }[] = [
  { key: "running", title: "Running" },
  { key: "waiting", title: "Waiting for you" },
  { key: "finished", title: "Finished" },
];

/** How many finished agents the list keeps. */
export const FINISHED_SHOWN = 10;

/**
 * Items that had an agent, grouped for the Agents view (spec 12.3). Items that never ran one are
 * left out. Running first by start, the rest most recent first.
 */
export function agentGroups(items: readonly ItemView[]): Record<AgentGroupKey, ItemView[]> {
  const out: Record<AgentGroupKey, ItemView[]> = { running: [], waiting: [], finished: [] };
  for (const item of items) {
    if (!item.agent.startedAt && !item.agent.running) continue;
    if (item.state === "running") out.running.push(item);
    else if (item.state === "needs_you") out.waiting.push(item);
    else out.finished.push(item);
  }
  const started = (i: ItemView) => i.agent.startedAt ?? "";
  out.running.sort((a, b) => started(a).localeCompare(started(b)));
  out.waiting.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  out.finished.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  out.finished.splice(FINISHED_SHOWN);
  return out;
}
