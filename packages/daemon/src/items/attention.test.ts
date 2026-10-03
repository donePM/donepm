import type { Draft, Event, PermissionAsk } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { attentionOf } from "./attention.js";

const ask = (state: PermissionAsk["state"]): PermissionAsk => ({
  id: `ask-${state}`, itemId: "i", requestId: "r", toolName: "Bash", input: { command: "ls" }, state, rules: [],
});
const draft = (over: Partial<Draft> = {}): Draft => ({
  id: "d1", itemId: "i", type: "pr", state: "pending", payload: { title: "Agent title", body: "", base: "main" }, ...over,
});
const failed = (payload: Record<string, unknown>): Event => ({
  id: "e", itemId: "i", at: "2026-10-03T00:00:00Z", actor: "system", type: "agent.failed", payload,
});

const live = { agentAlive: true, hasSession: true };

describe("attentionOf", () => {
  it("puts a pending question before a pending draft", () => {
    expect(attentionOf({ ...live, state: "needs_you", asks: [ask("allowed"), ask("pending")], drafts: [draft()], events: [] })).toEqual({
      kind: "ask", askId: "ask-pending", toolName: "Bash", input: { command: "ls" }, rules: [],
    });
  });

  it("shows the draft title as the user edited it", () => {
    const d = draft({ userEdits: { title: "Edited", body: "", base: "main" } });
    expect(attentionOf({ ...live, state: "needs_you", asks: [], drafts: [draft({ id: "old", state: "rejected" }), d], events: [] })).toEqual({
      kind: "draft", draftId: "d1", title: "Edited",
    });
  });

  it("shows a draft being executed, and one whose execution failed with the error", () => {
    expect(attentionOf({ ...live, state: "needs_you", asks: [], drafts: [draft({ state: "approved" })], events: [] })).toEqual({
      kind: "draft", draftId: "d1", title: "Agent title", executing: true,
    });
    const events: Event[] = [
      { id: "x", itemId: "i", at: "2026-10-03T00:00:00Z", actor: "system", type: "draft.execution_failed", refId: "d1", payload: { step: "push", error: "git push failed: denied" } },
    ];
    expect(attentionOf({ ...live, state: "needs_you", asks: [], drafts: [draft({ state: "failed" })], events })).toEqual({
      kind: "draft", draftId: "d1", title: "Agent title", error: "git push failed: denied",
    });
  });

  it("shows the latest failure with its stderr tail", () => {
    const events = [failed({ reason: "first" }), failed({ reason: "exit 1", stderrTail: "boom\n" })];
    expect(attentionOf({ ...live, state: "failed", asks: [], drafts: [], events })).toEqual({ kind: "failed", reason: "exit 1", stderrTail: "boom\n" });
    expect(attentionOf({ ...live, state: "failed", asks: [], drafts: [], events: [failed({ stderrTail: "  " })] })).toEqual({
      kind: "failed", reason: "agent failed",
    });
  });

  it("is empty when nothing waits on the user", () => {
    expect(attentionOf({ ...live, state: "running", asks: [ask("pending")], drafts: [draft()], events: [] })).toBeUndefined();
    expect(attentionOf({ ...live, state: "needs_you", asks: [], drafts: [], events: [] })).toBeUndefined();
  });

  it("offers to resume a waiting item whose process is gone, with the reason", () => {
    const events: Event[] = [
      { id: "x", itemId: "i", at: "2026-10-03T00:00:00Z", actor: "system", type: "agent.interrupted", payload: { reason: "daemon restarted" } },
    ];
    const base = { state: "needs_you" as const, asks: [ask("expired")], drafts: [], events };
    expect(attentionOf({ ...base, agentAlive: false, hasSession: true })).toEqual({ kind: "resume", reason: "daemon restarted" });
    expect(attentionOf({ ...base, agentAlive: true, hasSession: true })).toBeUndefined();
    expect(attentionOf({ ...base, agentAlive: false, hasSession: false })).toBeUndefined();
    expect(attentionOf({ ...base, drafts: [draft()], agentAlive: false, hasSession: true })).toMatchObject({ kind: "draft" });
  });
});
