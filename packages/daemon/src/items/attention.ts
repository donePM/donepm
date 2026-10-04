import type { Draft, DraftState, Event, ItemState, PermissionAsk, PermissionRule } from "@donepm/core";

const OPEN_DRAFT: ReadonlySet<DraftState> = new Set(["pending", "approved", "failed"]);

/** What a Needs You card shows: the one thing the user has to do (spec §12.1). */
export type Attention =
  | { kind: "ask"; askId: string; toolName: string; input: unknown; rules: PermissionRule[]; reason?: string }
  | {
      kind: "draft";
      draftId: string;
      title: string;
      /** Approved, git and gh are running. */
      executing?: true;
      /** The last execution failed; approving again retries. */
      error?: string;
    }
  | { kind: "failed"; reason: string; stderrTail?: string }
  /** No process is left for the waiting item (daemon restart); Resume continues its session. */
  | { kind: "resume"; reason: string };

/**
 * A pending permission question first (the agent is blocked on it), then an open draft (pending,
 * being executed, or failed to execute), then a session to resume, then the latest failure.
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
      const title = (draft.userEdits ?? draft.payload).title;
      if (draft.state === "approved") return { kind: "draft", draftId: draft.id, title, executing: true };
      if (draft.state === "failed") return { kind: "draft", draftId: draft.id, title, error: executionError(draft.id, input.events) };
      return { kind: "draft", draftId: draft.id, title };
    }
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

function executionError(draftId: string, events: readonly Event[]): string {
  const e = events.findLast((x) => x.type === "draft.execution_failed" && x.refId === draftId);
  return typeof e?.payload.error === "string" ? e.payload.error : "creating the pull request failed";
}
