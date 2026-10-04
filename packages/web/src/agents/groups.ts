import type { ItemView } from "../api/types";

export type AgentGroupKey = "running" | "checking" | "waiting" | "finished";

export const AGENT_GROUPS: { key: AgentGroupKey; title: string }[] = [
  { key: "running", title: "Running" },
  { key: "checking", title: "Waiting for CI" },
  { key: "waiting", title: "Waiting for you" },
  { key: "finished", title: "Finished today" },
];

/** How many finished agents the list keeps. */
export const FINISHED_SHOWN = 10;

/** Whether `iso` falls on the same local day as `now`. */
function sameDay(iso: string, now: number): boolean {
  const a = new Date(iso);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Items that had an agent, grouped for the Agents view (spec 12.3). Items that never ran one are
 * left out, and so are finished ones from before today. Running first by start, the rest most
 * recent first.
 */
export function agentGroups(items: readonly ItemView[], now: number): Record<AgentGroupKey, ItemView[]> {
  const out: Record<AgentGroupKey, ItemView[]> = { running: [], checking: [], waiting: [], finished: [] };
  for (const item of items) {
    if (!item.agent.startedAt && !item.agent.running) continue;
    if (item.state === "running") out.running.push(item);
    else if (item.state === "checking") out.checking.push(item);
    else if (item.state === "needs_you" || item.state === "failed") out.waiting.push(item);
    else if (sameDay(item.updatedAt, now)) out.finished.push(item);
  }
  const started = (i: ItemView) => i.agent.startedAt ?? "";
  const recent = (a: ItemView, b: ItemView) => b.updatedAt.localeCompare(a.updatedAt);
  out.running.sort((a, b) => started(a).localeCompare(started(b)));
  out.checking.sort(recent);
  out.waiting.sort(recent);
  out.finished.sort(recent);
  out.finished.splice(FINISHED_SHOWN);
  return out;
}
