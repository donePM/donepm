import type { Event, PermissionAsk, PrDraft, PushDraft } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { attentionOf } from "./attention.js";

const ask = (state: PermissionAsk["state"]): PermissionAsk => ({
  id: `ask-${state}`, itemId: "i", requestId: "r", toolName: "Bash", input: { command: "ls" }, state, rules: [],
});
const draft = (over: Partial<PrDraft> = {}): PrDraft => ({
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

  it("passes on why the CLI asked", () => {
    const asks = [{ ...ask("pending"), reason: "This command requires approval" }];
    expect(attentionOf({ ...live, state: "needs_you", asks, drafts: [], events: [] })).toMatchObject({ reason: "This command requires approval" });
  });

  it("shows the draft title as the user edited it", () => {
    const d = draft({ userEdits: { title: "Edited", body: "", base: "main" } });
    expect(attentionOf({ ...live, state: "needs_you", asks: [], drafts: [draft({ id: "old", state: "rejected" }), d], events: [] })).toEqual({
      kind: "draft", draftId: "d1", draftType: "pr", title: "Edited",
    });
  });

  it("shows a draft being executed, and one whose execution failed with the error", () => {
    expect(attentionOf({ ...live, state: "needs_you", asks: [], drafts: [draft({ state: "approved" })], events: [] })).toEqual({
      kind: "draft", draftId: "d1", draftType: "pr", title: "Agent title", executing: true,
    });
    const events: Event[] = [
      { id: "x", itemId: "i", at: "2026-10-03T00:00:00Z", actor: "system", type: "draft.execution_failed", refId: "d1", payload: { step: "push", error: "git push failed: denied" } },
    ];
    expect(attentionOf({ ...live, state: "needs_you", asks: [], drafts: [draft({ state: "failed" })], events })).toEqual({
      kind: "draft", draftId: "d1", draftType: "pr", title: "Agent title", error: "git push failed: denied",
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

  describe("red CI", () => {
    const pr = { number: 7, url: "https://github.com/o/r/pull/7" };
    const ev = (type: string, payload: Record<string, unknown> = {}): Event => ({
      id: type, itemId: "i", at: "2026-10-04T00:00:00Z", actor: "system", type: type as Event["type"], payload,
    });
    const red = ev("ci.failed", { ...pr, failed: [{ name: "test", link: "https://github.com/o/r/actions/runs/9/job/1" }], logs: [{ name: "test", tail: "boom" }] });
    const waiting = { state: "needs_you" as const, asks: [], drafts: [], agentAlive: false, hasSession: true };

    it("shows the failed checks, their logs and the runs to rerun", () => {
      expect(attentionOf({ ...waiting, events: [ev("ci.started", pr), red] })).toEqual({
        kind: "ci_failed",
        pr,
        failed: [{ name: "test", link: "https://github.com/o/r/actions/runs/9/job/1" }],
        logs: [{ name: "test", tail: "boom" }],
        runs: ["9"],
      });
    });

    it("shows a merge conflict the item waits on, before a red CI", () => {
      const conflicted = ev("pr.conflicted", { ...pr, base: "main", files: ["a.ts"], from: "checking" });
      expect(attentionOf({ ...waiting, events: [red, conflicted] })).toEqual({ kind: "pr_conflict", pr, base: "main", files: ["a.ts"] });
      expect(attentionOf({ ...waiting, events: [conflicted, ev("agent.resumed", { reason: "pr_conflict" }), ev("agent.turn_ended")] })).toMatchObject({ kind: "resume" });
      expect(attentionOf({ ...waiting, agentAlive: true, events: [conflicted] })).toBeUndefined();
    });

    it("comes before Resume and gives way once the agent works on it", () => {
      expect(attentionOf({ ...waiting, events: [red, ev("agent.resumed", { reason: "ci_failed" }), ev("agent.turn_ended")] })).toMatchObject({ kind: "resume" });
      expect(attentionOf({ ...waiting, agentAlive: true, events: [red] })).toBeUndefined();
    });

    it("names a push draft by its commits", () => {
      const push: PushDraft = {
        id: "p1", itemId: "i", type: "push", state: "failed",
        payload: { summary: "fix", ...pr, branch: "dp/7", commits: [{ sha: "a", subject: "Fix" }, { sha: "b", subject: "Test" }], uncommitted: false },
      };
      expect(attentionOf({ ...waiting, drafts: [push], events: [red] })).toEqual({
        kind: "draft", draftId: "p1", draftType: "push", title: "Push 2 commits to PR #7", error: "pushing the commits failed",
      });
    });
  });
});
