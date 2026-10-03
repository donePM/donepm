import { parseRules, toolSummary, type Event, type PermissionAsk } from "@donepm/core";
import { grantText } from "../asks/grant";

export type Tone = "attention" | "danger" | "user" | "system";

export interface TimelineEntry {
  id: string;
  at: string;
  tone: Tone;
  text: string;
  /** Shown in mono after the text, e.g. the tool call. */
  code?: string;
  /** Second line, e.g. a reason or the cost. */
  detail?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function askCode(ask: PermissionAsk | undefined, fallbackTool: unknown): string | undefined {
  if (!ask) return str(fallbackTool);
  const summary = toolSummary(ask.toolName, ask.input);
  return summary ? `${ask.toolName}: ${summary}` : ask.toolName;
}

function entry(e: Event, asks: ReadonlyMap<string, PermissionAsk>): Omit<TimelineEntry, "id" | "at"> {
  const p = e.payload;
  const ask = e.refId ? asks.get(e.refId) : undefined;
  switch (e.type) {
    case "item.collected":
      return { tone: "system", text: "Collected from GitHub" };
    case "item.playbook_changed":
      return { tone: "user", text: "You changed the playbook", ...(str(p.name) ? { code: str(p.name) } : {}) };
    case "item.assigned":
      return { tone: "system", text: "Assigned the issue to you on GitHub" };
    case "item.assign_failed":
      return { tone: "attention", text: "Assigning the issue to you failed", ...(str(p.reason) ? { detail: str(p.reason) } : {}) };
    case "agent.started":
      return { tone: e.actor === "user" ? "user" : "system", text: "Agent started" };
    case "agent.resumed":
      return { tone: e.actor === "user" ? "user" : "system", text: e.actor === "user" ? "You resumed the agent" : "Agent resumed" };
    case "agent.interrupted":
      return { tone: "attention", text: "Agent interrupted", ...(str(p.reason) ? { detail: str(p.reason) } : {}) };
    case "agent.turn_started":
      return { tone: "system", text: "Agent continued" };
    case "agent.turn_ended":
      return {
        tone: "system",
        text: p.isError === true ? "Agent turn ended with an error" : "Agent turn ended",
        ...(typeof p.costUsd === "number" ? { detail: `$${p.costUsd.toFixed(2)} so far in this run` } : {}),
      };
    case "agent.failed":
      return { tone: "danger", text: "Agent failed", ...(str(p.reason) ? { detail: str(p.reason) } : {}) };
    case "permission.asked":
      return { tone: "attention", text: "Agent asked permission", ...withCode(askCode(ask, p.toolName)) };
    case "permission.answered": {
      const grant = p.behavior === "allow" ? grantText(parseRules(p.rules)) : undefined;
      return {
        tone: "user",
        text: p.behavior === "allow" ? (grant ? "You allowed for this run" : "You allowed") : "You denied",
        ...withCode(askCode(ask, undefined)),
        ...(grant ? { detail: `Also allowed until the run ends: ${grant}` } : {}),
      };
    }
    case "permission.auto_allowed":
      return {
        tone: "system",
        text: "Allowed web access on your list",
        ...withCode(askCode(ask, p.toolName)),
        ...(str(p.domain) ? { detail: `${str(p.domain)} is in Settings → Web access` } : {}),
      };
    case "draft.created":
      return { tone: "attention", text: "Agent created PR draft", ...(str(p.title) ? { detail: str(p.title) } : {}) };
    case "draft.edited":
      return { tone: "user", text: "You edited the PR draft" };
    case "draft.approved":
      return { tone: "user", text: "You approved the PR draft" };
    case "draft.rejected":
      return { tone: "user", text: "You rejected the PR draft", ...(str(p.reason) ? { detail: str(p.reason) } : {}) };
    case "draft.executed":
      return { tone: "system", text: "Pull request created", ...(str(p.url) ? { detail: str(p.url) } : {}) };
    case "draft.execution_failed":
      return { tone: "danger", text: "Creating the pull request failed", ...(str(p.error) ? { detail: str(p.error) } : {}) };
    case "worktree.removed":
      return { tone: "user", text: "You removed the worktree", ...(str(p.branch) ? { detail: `Branch ${str(p.branch)} kept` } : {}) };
    default:
      // Newer daemons may write types this UI does not know yet.
      return { tone: "system", text: String(e.type) };
  }
}

const withCode = (code: string | undefined) => (code ? { code } : {});

/** Events as the item detail lists them: newest first (spec §12.2). */
export function timelineEntries(events: readonly Event[], asks: readonly PermissionAsk[]): TimelineEntry[] {
  const byId = new Map(asks.map((a) => [a.id, a]));
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.at.localeCompare(a.e.at) || b.i - a.i)
    .map(({ e }) => ({ id: e.id, at: e.at, ...entry(e, byId) }));
}

/** "09:41" today, "Yesterday 17:02", else "Sep 28 17:02". Local time. */
export function timeLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return hm;
  if (diff === 1) return `Yesterday ${hm}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${hm}`;
}
