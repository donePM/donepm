import { isQuestionTool, parseRules, questionsOf, toolSummary, type Event, type PermissionAsk } from "@donepm/core";
import { grantText } from "../asks/grant";
import { askCopyText, askView } from "../asks/view";

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
  /** The whole tool input when `code` shows only its first line; the code's tooltip. */
  full?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function askCode(ask: PermissionAsk | undefined, fallbackTool: unknown): string | undefined {
  if (!ask) return str(fallbackTool);
  const summary = toolSummary(ask.toolName, ask.input);
  return summary ? `${ask.toolName}: ${summary}` : ask.toolName;
}

/** The ask's whole input for the tooltip, only when the one-line summary leaves something out. */
function askFull(ask: PermissionAsk | undefined): { full?: string } {
  if (!ask) return {};
  const full = askCopyText(askView(ask.toolName, ask.input));
  return full && full !== toolSummary(ask.toolName, ask.input) ? { full } : {};
}

function isQuestion(ask: PermissionAsk | undefined, fallbackTool: unknown): boolean {
  return isQuestionTool(ask?.toolName ?? str(fallbackTool) ?? "");
}

function questionCode(ask: PermissionAsk | undefined): string | undefined {
  return ask ? str(toolSummary(ask.toolName, ask.input)) : undefined;
}

/** "Color: Green · Sizes: Small, Large", headers where the agent gave them, in question order. */
function answersText(ask: PermissionAsk | undefined, answers: unknown): string | undefined {
  if (typeof answers !== "object" || answers === null) return undefined;
  const given = answers as Record<string, unknown>;
  const questions = ask ? questionsOf(ask.input) : [];
  const parts = questions.length
    ? questions.flatMap((q) => (str(given[q.question]) ? [`${q.header || q.question}: ${str(given[q.question])}`] : []))
    : Object.entries(given).flatMap(([k, v]) => (str(v) ? [`${k}: ${str(v)}`] : []));
  return parts.length ? parts.join(" · ") : undefined;
}

function entry(e: Event, asks: ReadonlyMap<string, PermissionAsk>, pushDrafts: ReadonlySet<string>): Omit<TimelineEntry, "id" | "at"> {
  const p = e.payload;
  const ask = e.refId ? asks.get(e.refId) : undefined;
  const push = e.refId !== undefined && pushDrafts.has(e.refId);
  const draftName = push ? "push draft" : "PR draft";
  switch (e.type) {
    case "item.collected":
      return { tone: "system", text: "Collected from GitHub" };
    case "item.playbook_changed":
      return { tone: "user", text: "You changed the playbook", ...(str(p.name) ? { code: str(p.name) } : {}) };
    case "item.assigned":
      return { tone: "system", text: "Assigned the issue to you on GitHub" };
    case "item.closed_upstream":
      return { tone: "system", text: "Closed on GitHub, moved to Done" };
    case "item.dismissed":
      return { tone: "user", text: "You dismissed it after it was closed on GitHub" };
    case "item.archived":
      return { tone: "system", text: "Moved to the Archive" };
    case "item.assign_failed":
      return { tone: "attention", text: "Assigning the issue to you failed", ...(str(p.reason) ? { detail: str(p.reason) } : {}) };
    case "agent.started":
      return { tone: e.actor === "user" ? "user" : "system", text: "Agent started" };
    case "agent.resumed":
      if (p.reason === "ci_failed") return { tone: "user", text: "You let the agent fix the failed CI" };
      if (p.reason === "pr_conflict") return { tone: "user", text: "You let the agent resolve the merge conflict" };
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
      if (isQuestion(ask, p.toolName)) return { tone: "attention", text: "Agent asked you", ...withCode(questionCode(ask)) };
      return { tone: "attention", text: "Agent asked permission", ...withCode(askCode(ask, p.toolName)), ...askFull(ask) };
    case "permission.answered": {
      if (e.actor === "system") {
        return { tone: "system", text: "Denied by donePM", ...(str(p.reason) ? { detail: str(p.reason) } : {}) };
      }
      if (isQuestion(ask, undefined)) {
        const detail = answersText(ask, p.answers);
        return {
          tone: "user",
          text: p.behavior === "allow" ? "You answered" : "You declined the questions",
          ...withCode(questionCode(ask)),
          ...(detail ? { detail } : {}),
        };
      }
      const grant = p.behavior === "allow" ? grantText(parseRules(p.rules)) : undefined;
      return {
        tone: "user",
        text: p.behavior === "allow" ? (grant ? "You allowed for this run" : "You allowed") : "You denied",
        ...withCode(askCode(ask, undefined)),
        ...askFull(ask),
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
      return { tone: "attention", text: `Agent created ${draftName}`, ...(str(p.title) ? { detail: str(p.title) } : {}) };
    case "draft.edited":
      return { tone: "user", text: `You edited the ${draftName}` };
    case "draft.approved":
      return { tone: "user", text: `You approved the ${draftName}` };
    case "draft.rejected":
      return { tone: "user", text: `You rejected the ${draftName}`, ...(str(p.reason) ? { detail: str(p.reason) } : {}) };
    case "draft.executed":
      if (push) return { tone: "system", text: "Commits pushed", ...(str(p.sha) ? { code: str(p.sha)!.slice(0, 7) } : {}) };
      return { tone: "system", text: "Pull request created", ...(str(p.url) ? { detail: str(p.url) } : {}) };
    case "draft.execution_failed":
      return { tone: "danger", text: push ? "Pushing failed" : "Creating the pull request failed", ...(str(p.error) ? { detail: str(p.error) } : {}) };
    case "ci.started":
      if (p.reason === "rerun") return { tone: "user", text: `You reran the failed jobs on ${prName(p.number)}` };
      return { tone: "system", text: `Waiting for CI on ${prName(p.number)}` };
    case "ci.passed":
      return { tone: "system", text: p.checks === 0 ? `${prName(p.number)} has no CI, done` : "CI passed, done" };
    case "ci.failed": {
      const failed = Array.isArray(p.failed) ? p.failed.flatMap((c: unknown) => str((c as { name?: unknown } | null)?.name) ?? []) : [];
      return { tone: "attention", text: "CI failed", ...(failed.length ? { detail: failed.join(", ") } : {}) };
    }
    case "ci.marked_done":
      return { tone: "user", text: "You marked it done without green CI" };
    case "pr.conflicted": {
      const files = Array.isArray(p.files) ? p.files.filter((f) => typeof f === "string") : [];
      const base = str(p.base) ?? "its base";
      return { tone: "attention", text: `${prName(p.number)} has merge conflicts with ${base}`, ...(files.length ? { detail: files.join(", ") } : {}) };
    }
    case "pr.conflict_resolved":
      return { tone: "system", text: `${prName(p.number)} can be merged again` };
    case "pr.conflict_dismissed":
      return { tone: "user", text: "You'll resolve the merge conflict yourself" };
    case "item.pr_merged":
      return { tone: "system", text: `${prName(p.number)} merged` };
    case "worktree.removed": {
      const kept = str(p.branch) ? { detail: `Branch ${str(p.branch)} kept` } : {};
      if (p.reason === "pr_merged") return { tone: "system", text: `${prName(p.number)} merged, worktree removed`, ...kept };
      return { tone: "user", text: "You removed the worktree", ...kept };
    }
    case "worktree.remove_skipped": {
      const files = Array.isArray(p.files) ? p.files.filter((f) => typeof f === "string") : [];
      const reason = str(p.reason) ?? "unknown reason";
      return { tone: "attention", text: "Worktree not removed", detail: files.length ? `${reason}: ${files.join(", ")}` : reason };
    }
    default:
      // Newer daemons may write types this UI does not know yet.
      return { tone: "system", text: String(e.type) };
  }
}

const withCode = (code: string | undefined) => (code ? { code } : {});
const prName = (n: unknown) => (typeof n === "number" ? `PR #${n}` : "PR");

/** Events as the item detail lists them: newest first (spec §12.2). */
export function timelineEntries(events: readonly Event[], asks: readonly PermissionAsk[]): TimelineEntry[] {
  const byId = new Map(asks.map((a) => [a.id, a]));
  // Only `draft.created` says which kind of draft; the later draft events point to it by refId.
  const pushDrafts = new Set(events.flatMap((e) => (e.type === "draft.created" && e.payload.type === "push" && e.refId ? [e.refId] : [])));
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.at.localeCompare(a.e.at) || b.i - a.i)
    .map(({ e }) => ({ id: e.id, at: e.at, ...entry(e, byId, pushDrafts) }));
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
