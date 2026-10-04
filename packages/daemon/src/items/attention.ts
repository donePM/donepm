import {
  ciFailureOf, draftTitle,
  type CheckLog, type CiPr, type Draft, type DraftState, type DraftType, type Event, type FailedCheck, type ItemState,
  type PermissionAsk, type PermissionRule,
} from "@donepm/core";

const OPEN_DRAFT: ReadonlySet<DraftState> = new Set(["pending", "approved", "failed"]);

/** What a Needs You card shows: the one thing the user has to do (spec §12.1). */
export type Attention =
  | { kind: "ask"; askId: string; toolName: string; input: unknown; rules: PermissionRule[]; reason?: string }
  | {
      kind: "draft";
      draftId: string;
      draftType: DraftType;
      title: string;
      /** Approved, git and gh are running. */
      executing?: true;
      /** The last execution failed; approving again retries. */
      error?: string;
    }
  | { kind: "failed"; reason: string; stderrTail?: string }
  /** The PR's CI is red (D35): fix with the agent, rerun the failed jobs, or mark done anyway. */
  | { kind: "ci_failed"; pr?: CiPr; failed: FailedCheck[]; logs: CheckLog[]; runs: string[] }
  /** No process is left for the waiting item (daemon restart); Resume continues its session. */
  | { kind: "resume"; reason: string };

/**
 * A pending permission question first (the agent is blocked on it), then an open draft (pending,
 * being executed, or failed to execute), then a red CI, then a session to resume, then the latest
 * failure.
 * Nothing for items that do not wait on the user.
 */
export function attentionOf(input: {
  state: ItemState;
  /** A `claude` process is alive for the item. */
  agentAlive: boolean;
  /** The item has a session `--resume` can continue. */
  hasSession: boolean;
  asks: readonly PermissionAsk[];
  drafts: readonly Draft[];
  events: readonly Event[];
}): Attention | undefined {
  if (input.state === "needs_you") {
    const ask = input.asks.find((a) => a.state === "pending");
    if (ask) {
      return { kind: "ask", askId: ask.id, toolName: ask.toolName, input: ask.input, rules: ask.rules, ...(ask.reason ? { reason: ask.reason } : {}) };
    }
    const draft = input.drafts.find((d) => OPEN_DRAFT.has(d.state));
    if (draft) {
      const base = { kind: "draft" as const, draftId: draft.id, draftType: draft.type, title: draftTitle(draft) };
      if (draft.state === "approved") return { ...base, executing: true };
      if (draft.state === "failed") return { ...base, error: executionError(draft, input.events) };
      return base;
    }
    const ci = ciFailureOf(input.events);
    if (ci && !input.agentAlive) return { kind: "ci_failed", ...ci };
    if (!input.agentAlive && input.hasSession) {
      const stopped = input.events.findLast((e) => e.type === "agent.interrupted");
      const reason = typeof stopped?.payload.reason === "string" ? stopped.payload.reason : "the agent is not running";
      return { kind: "resume", reason };
    }
    return undefined;
  }
  if (input.state === "failed") {
    const failed = input.events.findLast((e) => e.type === "agent.failed");
    const reason = typeof failed?.payload.reason === "string" ? failed.payload.reason : "agent failed";
    const tail = failed?.payload.stderrTail;
    return { kind: "failed", reason, ...(typeof tail === "string" && tail.trim() ? { stderrTail: tail } : {}) };
  }
  return undefined;
}

function executionError(draft: Draft, events: readonly Event[]): string {
  const e = events.findLast((x) => x.type === "draft.execution_failed" && x.refId === draft.id);
  if (typeof e?.payload.error === "string") return e.payload.error;
  return draft.type === "pr" ? "creating the pull request failed" : "pushing the commits failed";
}
