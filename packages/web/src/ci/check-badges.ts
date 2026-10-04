import type { CiCheckView } from "../api/types";
import { clock } from "../time/duration";

/** One CI check on a waiting card: passed green with a tick, failed red, the rest muted. */
export interface CheckBadge {
  name: string;
  text: string;
  tone: "ok" | "danger" | "muted";
  passed: boolean;
}

/** In gh's order; a running check shows how long it runs: "types · 1:20". */
export function checkBadges(checks: readonly CiCheckView[], now: number): CheckBadge[] {
  return checks.map((c) => {
    if (c.bucket === "pass") return { name: c.name, text: c.name, tone: "ok", passed: true };
    if (c.bucket === "fail" || c.bucket === "cancel") return { name: c.name, text: c.name, tone: "danger", passed: false };
    const running = c.bucket === "pending" && c.startedAt ? ` · ${clock(now - Date.parse(c.startedAt))}` : "";
    return { name: c.name, text: `${c.name}${running}`, tone: "muted", passed: false };
  });
}
