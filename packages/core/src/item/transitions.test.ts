import { describe, expect, it } from "vitest";
import type { Ctx } from "../ids.js";
import {
  InvalidTransitionError, agentAsked, agentFailed, answered, autoAllowed, draftApproved, draftCreated, draftEdited, draftExecuted,
  draftExecutionFailed, draftRejected, interrupted, issueAssignFailed, issueAssigned, resume, start, worktreeRemoved,
  turnEnded, turnStarted, closedUpstream, dismissed, wasStarted,
} from "./transitions.js";
import type { ItemState, WorkItem } from "./types.js";

function makeCtx(): Ctx {
  let n = 0;
  return { now: () => "2026-10-03T12:00:00.000Z", newId: () => `evt-${++n}` };
}

function item(state: ItemState, extra: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "item-1", source: "github-issue", externalId: "o/r#1", externalUrl: "https://github.com/o/r/issues/1",
    repoId: "repo-1", title: "T", body: "", labels: [], state, playbook: "implement", priority: 0,
    stateSince: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

const ALL: ItemState[] = ["ready", "running", "needs_you", "done", "failed"];

const table: Array<{
  name: string;
  run: (i: WorkItem) => ReturnType<typeof start>;
  from: ItemState[];
  to: ItemState;
  type: string;
  actor: string;
}> = [
  { name: "start", run: (i) => start(i, makeCtx()), from: ["ready", "failed"], to: "running", type: "agent.started", actor: "system" },
  { name: "agentAsked", run: (i) => agentAsked(i, makeCtx(), "ask-1"), from: ["running", "needs_you"], to: "needs_you", type: "permission.asked", actor: "agent" },
  { name: "answered", run: (i) => answered(i, makeCtx(), "ask-1"), from: ["needs_you"], to: "running", type: "permission.answered", actor: "user" },
  { name: "turnEnded", run: (i) => turnEnded(i, makeCtx()), from: ["running"], to: "needs_you", type: "agent.turn_ended", actor: "agent" },
  { name: "turnStarted", run: (i) => turnStarted(i, makeCtx()), from: ["needs_you"], to: "running", type: "agent.turn_started", actor: "agent" },
  { name: "draftCreated", run: (i) => draftCreated(i, makeCtx(), "d-1"), from: ["running"], to: "needs_you", type: "draft.created", actor: "agent" },
  { name: "draftEdited", run: (i) => draftEdited(i, makeCtx(), "d-1"), from: ["needs_you"], to: "needs_you", type: "draft.edited", actor: "user" },
  { name: "draftApproved", run: (i) => draftApproved(i, makeCtx(), "d-1"), from: ["needs_you"], to: "needs_you", type: "draft.approved", actor: "user" },
  { name: "draftExecuted", run: (i) => draftExecuted(i, makeCtx(), "d-1", { url: "u", number: 1 }), from: ["needs_you"], to: "done", type: "draft.executed", actor: "system" },
  { name: "draftExecutionFailed", run: (i) => draftExecutionFailed(i, makeCtx(), "d-1", { step: "push" }), from: ["needs_you"], to: "needs_you", type: "draft.execution_failed", actor: "system" },
  { name: "draftRejected", run: (i) => draftRejected(i, makeCtx(), "d-1", "nope"), from: ["needs_you"], to: "running", type: "draft.rejected", actor: "user" },
  { name: "interrupted", run: (i) => interrupted(i, makeCtx(), "daemon restarted"), from: ["running", "needs_you"], to: "needs_you", type: "agent.interrupted", actor: "system" },
  { name: "resume", run: (i) => resume({ ...i, agentSessionId: "sess" }, makeCtx()), from: ["needs_you"], to: "running", type: "agent.resumed", actor: "user" },
  { name: "agentFailed", run: (i) => agentFailed(i, makeCtx(), "boom"), from: ["running", "needs_you"], to: "failed", type: "agent.failed", actor: "system" },
];

describe.each(table)("$name", ({ run, from, to, type, actor, name }) => {
  it.each(from)("valid from %s", (state) => {
    const before = item(state);
    const { item: after, events } = run(before);
    expect(after.state).toBe(to);
    expect(after.updatedAt).toBe("2026-10-03T12:00:00.000Z");
    expect(after.stateSince).toBe(state === to ? "2026-10-01T00:00:00.000Z" : "2026-10-03T12:00:00.000Z");
    expect(before.state).toBe(state); // input not mutated
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ itemId: "item-1", type, actor, id: "evt-1", at: "2026-10-03T12:00:00.000Z" });
  });

  it.each(ALL.filter((s) => !from.includes(s)))("throws from %s", (state) => {
    expect(() => run(item(state))).toThrow(InvalidTransitionError);
    expect(() => run(item(state))).toThrow(new RegExp(`${name}.*${state}`));
  });
});

describe("details", () => {
  it("agentFailed carries details next to the reason", () => {
    const { events } = agentFailed(item("running"), makeCtx(), "exit 1", { stderrTail: ["boom"] });
    expect(events[0]?.payload).toEqual({ reason: "exit 1", stderrTail: ["boom"] });
  });

  it("answered keeps the item waiting while other asks are pending", () => {
    const { item: after, events } = answered(item("needs_you"), makeCtx(), "ask-1", {}, true);
    expect(after.state).toBe("needs_you");
    expect(events[0]?.type).toBe("permission.answered");
  });

  it("start emits agent.resumed when a session exists", () => {
    const { events } = start(item("failed", { agentSessionId: "sess" }), makeCtx());
    expect(events[0]?.type).toBe("agent.resumed");
  });
  it("carries refId and payload", () => {
    expect(agentAsked(item("running"), makeCtx(), "ask-9", { toolName: "Bash" }).events[0])
      .toMatchObject({ refId: "ask-9", payload: { toolName: "Bash" } });
    expect(draftRejected(item("needs_you"), makeCtx(), "d-2", "too long").events[0])
      .toMatchObject({ refId: "d-2", payload: { reason: "too long" } });
  });
  it("agentFailed has no refId", () => {
    expect(agentFailed(item("running"), makeCtx()).events[0]).not.toHaveProperty("refId");
  });

  it("interrupted carries the reason", () => {
    expect(interrupted(item("running"), makeCtx(), "daemon restarted").events[0]?.payload).toEqual({ reason: "daemon restarted" });
  });

  it("resume needs a session", () => {
    expect(() => resume(item("needs_you"), makeCtx())).toThrow(InvalidTransitionError);
  });
});

describe("startedAt and stateSince", () => {
  const at = (now: string): Ctx => ({ now: () => now, newId: () => "evt" });

  it("start sets startedAt on the first start only", () => {
    const first = start(item("ready"), at("2026-10-03T10:00:00.000Z")).item;
    expect(first).toMatchObject({ startedAt: "2026-10-03T10:00:00.000Z", stateSince: "2026-10-03T10:00:00.000Z" });
    const failed = agentFailed(first, at("2026-10-03T11:00:00.000Z")).item;
    const retried = start(failed, at("2026-10-03T12:00:00.000Z")).item;
    expect(retried).toMatchObject({ startedAt: "2026-10-03T10:00:00.000Z", stateSince: "2026-10-03T12:00:00.000Z" });
  });

  it("keeps startedAt through a Needs You round trip and moves stateSince on each state change", () => {
    const running = start(item("ready"), at("2026-10-03T10:00:00.000Z")).item;
    const waiting = agentAsked(running, at("2026-10-03T10:05:00.000Z"), "ask-1").item;
    expect(waiting).toMatchObject({ state: "needs_you", stateSince: "2026-10-03T10:05:00.000Z" });
    const back = answered(waiting, at("2026-10-03T10:06:00.000Z"), "ask-1").item;
    expect(back).toMatchObject({ state: "running", startedAt: "2026-10-03T10:00:00.000Z", stateSince: "2026-10-03T10:06:00.000Z" });
  });

  it("keeps stateSince while the item stays in Needs You", () => {
    const waiting = agentAsked(item("running"), at("2026-10-03T10:05:00.000Z"), "ask-1").item;
    const second = agentAsked(waiting, at("2026-10-03T10:07:00.000Z"), "ask-2").item;
    const edited = draftEdited(second, at("2026-10-03T10:09:00.000Z"), "d-1").item;
    expect(edited.stateSince).toBe("2026-10-03T10:05:00.000Z");
  });

  it("sets stateSince when the item enters done and keeps it on later updates", () => {
    const done = draftExecuted(item("needs_you"), at("2026-10-03T10:00:00.000Z"), "d-1").item;
    expect(done.stateSince).toBe("2026-10-03T10:00:00.000Z");
    const removed = worktreeRemoved({ ...done, worktreePath: "/wt/1" }, at("2026-10-04T09:00:00.000Z")).item;
    expect(removed).toMatchObject({ stateSince: "2026-10-03T10:00:00.000Z", updatedAt: "2026-10-04T09:00:00.000Z" });
  });

  it("only start sets startedAt", () => {
    expect(resume(item("needs_you", { agentSessionId: "sess" }), makeCtx()).item).not.toHaveProperty("startedAt");
  });
});

describe("worktreeRemoved", () => {
  it.each(["done", "failed"] as const)("keeps %s and clears the worktree path and session", (state) => {
    const before = item(state, { worktreePath: "/wt/1", branch: "dp/1-t", agentSessionId: "sess" });
    const { item: after, events } = worktreeRemoved(before, makeCtx(), { path: "/wt/1" });
    expect(after.state).toBe(state);
    expect(after).not.toHaveProperty("worktreePath");
    expect(after).not.toHaveProperty("agentSessionId");
    expect(after.branch).toBe("dp/1-t");
    expect(before.worktreePath).toBe("/wt/1");
    expect(events[0]).toMatchObject({ type: "worktree.removed", actor: "user", payload: { path: "/wt/1" } });
  });

  it.each(["ready", "running", "needs_you"] as const)("throws from %s", (state) => {
    expect(() => worktreeRemoved(item(state), makeCtx())).toThrow(InvalidTransitionError);
  });
});

describe("issueAssigned / issueAssignFailed", () => {
  it.each(ALL)("records the assignment without leaving %s", (state) => {
    const { item: after, events } = issueAssigned(item(state), makeCtx(), { assignee: "@me" });
    expect(after.state).toBe(state);
    expect(events[0]).toMatchObject({ type: "item.assigned", actor: "system", payload: { assignee: "@me" } });
  });

  it.each(ALL)("records a failed assignment without leaving %s", (state) => {
    const { item: after, events } = issueAssignFailed(item(state), makeCtx(), "HTTP 403");
    expect(after.state).toBe(state);
    expect(events[0]).toMatchObject({ type: "item.assign_failed", actor: "system", payload: { reason: "HTTP 403" } });
  });
});

describe("autoAllowed", () => {
  it.each(["running", "needs_you"] as const)("records the daemon's answer without leaving %s", (state) => {
    const { item: after, events } = autoAllowed(item(state), makeCtx(), "ask-1", { toolName: "WebFetch", host: "github.com" });
    expect(after.state).toBe(state);
    expect(events[0]).toMatchObject({
      type: "permission.auto_allowed", actor: "system", refId: "ask-1", payload: { toolName: "WebFetch", host: "github.com" },
    });
  });

  it.each(["ready", "done", "failed"] as const)("throws from %s", (state) => {
    expect(() => autoAllowed(item(state), makeCtx(), "ask-1")).toThrow(InvalidTransitionError);
  });
});

describe("closedUpstream", () => {
  it("moves a never-started ready item to done with the badge", () => {
    const { item: after, events } = closedUpstream(item("ready"), makeCtx());
    expect(after).toMatchObject({ state: "done", closedUpstream: true });
    expect(events[0]).toMatchObject({ type: "item.closed_upstream", actor: "system" });
  });

  it.each([{ worktreePath: "/wt/1" }, { agentSessionId: "sess" }])("leaves a started item alone (%o)", (extra) => {
    expect(wasStarted(item("ready", extra))).toBe(true);
    expect(() => closedUpstream(item("ready", extra), makeCtx())).toThrow(InvalidTransitionError);
  });

  it.each(["running", "needs_you", "done", "failed"] as const)("throws from %s", (state) => {
    expect(() => closedUpstream(item(state), makeCtx())).toThrow(InvalidTransitionError);
  });
});

describe("dismissed", () => {
  it.each(["ready", "needs_you", "failed"] as const)("moves a closed-upstream item from %s to done, keeping its worktree", (state) => {
    const { item: after, events } = dismissed(item(state, { closedUpstream: true, worktreePath: "/wt/1" }), makeCtx());
    expect(after).toMatchObject({ state: "done", worktreePath: "/wt/1" });
    expect(events[0]).toMatchObject({ type: "item.dismissed", actor: "user" });
  });

  it.each(["running", "done"] as const)("throws from %s", (state) => {
    expect(() => dismissed(item(state, { closedUpstream: true }), makeCtx())).toThrow(InvalidTransitionError);
  });

  it("throws when the issue is not closed upstream", () => {
    expect(() => dismissed(item("ready"), makeCtx())).toThrow(InvalidTransitionError);
  });
});
