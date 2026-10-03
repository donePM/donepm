import type { Draft, Event, ItemState, PermissionAsk } from "@donepm/core";

/** What a Needs You card shows: the one thing the user has to do (spec §12.1). */
export type Attention =
  | { kind: "ask"; askId: string; toolName: string; input: unknown }
  | { kind: "draft"; draftId: string; title: string }
  | { kind: "failed"; reason: string; stderrTail?: string };

/**
 * A pending permission question first (the agent is blocked on it), then a pending draft, then
 * the latest failure. Nothing for items that do not wait on the user.
 */
export function attentionOf(input: {
  state: ItemState;
  asks: readonly PermissionAsk[];
  drafts: readonly Draft[];
  events: readonly Event[];
}): Attention | undefined {
  if (input.state === "needs_you") {
    const ask = input.asks.find((a) => a.state === "pending");
    if (ask) return { kind: "ask", askId: ask.id, toolName: ask.toolName, input: ask.input };
    const draft = input.drafts.find((d) => d.state === "pending");
    if (draft) return { kind: "draft", draftId: draft.id, title: (draft.userEdits ?? draft.payload).title };
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
