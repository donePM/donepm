/** Elapsed time as on a stopwatch: "0:42", "6:12", "1:02:03". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "$0.41". */
export function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** How long the agent worked: closed intervals plus the one running now (spec 12.1). */
export function agentElapsed(agent: { elapsedMs?: number; activeSince?: string }, now: number): number | undefined {
  if (agent.elapsedMs === undefined && !agent.activeSince) return undefined;
  return (agent.elapsedMs ?? 0) + (agent.activeSince ? Math.max(0, now - Date.parse(agent.activeSince)) : 0);
}
