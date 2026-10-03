import type { Draft, Event, PermissionAsk } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { attentionOf } from "./attention.js";

const ask = (state: PermissionAsk["state"]): PermissionAsk => ({
  id: `ask-${state}`, itemId: "i", requestId: "r", toolName: "Bash", input: { command: "ls" }, state,
});
const draft = (over: Partial<Draft> = {}): Draft => ({
  id: "d1", itemId: "i", type: "pr", state: "pending", payload: { title: "Agent title", body: "", base: "main" }, ...over,
});
const failed = (payload: Record<string, unknown>): Event => ({
  id: "e", itemId: "i", at: "2026-10-03T00:00:00Z", actor: "system", type: "agent.failed", payload,
});

describe("attentionOf", () => {
  it("puts a pending question before a pending draft", () => {
    expect(attentionOf({ state: "needs_you", asks: [ask("allowed"), ask("pending")], drafts: [draft()], events: [] })).toEqual({
      kind: "ask", askId: "ask-pending", toolName: "Bash", input: { command: "ls" },
    });
  });

  it("shows the draft title as the user edited it", () => {
    const d = draft({ userEdits: { title: "Edited", body: "", base: "main" } });
    expect(attentionOf({ state: "needs_you", asks: [], drafts: [draft({ id: "old", state: "rejected" }), d], events: [] })).toEqual({
      kind: "draft", draftId: "d1", title: "Edited",
    });
  });

  it("shows a draft being executed, and one whose execution failed with the error", () => {
    expect(attentionOf({ state: "needs_you", asks: [], drafts: [draft({ state: "approved" })], events: [] })).toEqual({
      kind: "draft", draftId: "d1", title: "Agent title", executing: true,
    });
    const events: Event[] = [
      { id: "x", itemId: "i", at: "2026-10-03T00:00:00Z", actor: "system", type: "draft.execution_failed", refId: "d1", payload: { step: "push", error: "git push failed: denied" } },
    ];
    expect(attentionOf({ state: "needs_you", asks: [], drafts: [draft({ state: "failed" })], events })).toEqual({
      kind: "draft", draftId: "d1", title: "Agent title", error: "git push failed: denied",
    });
  });

  it("shows the latest failure with its stderr tail", () => {
    const events = [failed({ reason: "first" }), failed({ reason: "exit 1", stderrTail: "boom\n" })];
    expect(attentionOf({ state: "failed", asks: [], drafts: [], events })).toEqual({ kind: "failed", reason: "exit 1", stderrTail: "boom\n" });
    expect(attentionOf({ state: "failed", asks: [], drafts: [], events: [failed({ stderrTail: "  " })] })).toEqual({
      kind: "failed", reason: "agent failed",
    });
  });

  it("is empty when nothing waits on the user", () => {
    expect(attentionOf({ state: "running", asks: [ask("pending")], drafts: [draft()], events: [] })).toBeUndefined();
    expect(attentionOf({ state: "needs_you", asks: [], drafts: [], events: [] })).toBeUndefined();
  });
});
