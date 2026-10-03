import type { Event, PermissionAsk } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { timeLabel, timelineEntries } from "./entries";

let n = 0;
const ev = (type: string, payload: Record<string, unknown> = {}, over: Partial<Event> = {}): Event => {
  n++;
  return { id: `e${n}`, itemId: "i", at: `2026-10-03T09:${String(n).padStart(2, "0")}:00Z`, actor: "system", type: type as Event["type"], payload, ...over };
};
const ask: PermissionAsk = { id: "a1", itemId: "i", requestId: "r", toolName: "Bash", input: { command: "composer test" }, state: "allowed" };

describe("timelineEntries", () => {
  it("lists newest first with text for each event", () => {
    const events = [
      ev("item.collected"),
      ev("agent.started"),
      ev("permission.asked", { toolName: "Bash" }, { refId: "a1", actor: "agent" }),
      ev("permission.answered", { behavior: "allow" }, { refId: "a1", actor: "user" }),
      ev("agent.turn_ended", { costUsd: 0.856 }),
      ev("draft.created", { title: "Fix it" }, { actor: "agent" }),
      ev("draft.rejected", { reason: "Add a test" }, { actor: "user" }),
      ev("agent.failed", { reason: "exit 1" }),
      ev("something.new"),
    ];
    expect(timelineEntries(events, [ask]).map(({ tone, text, code, detail }) => ({ tone, text, code, detail }))).toEqual([
      { tone: "system", text: "something.new", code: undefined, detail: undefined },
      { tone: "danger", text: "Agent failed", code: undefined, detail: "exit 1" },
      { tone: "user", text: "You rejected the PR draft", code: undefined, detail: "Add a test" },
      { tone: "attention", text: "Agent created PR draft", code: undefined, detail: "Fix it" },
      { tone: "system", text: "Agent turn ended", code: undefined, detail: "$0.86 so far in this run" },
      { tone: "user", text: "You allowed", code: "Bash: composer test", detail: undefined },
      { tone: "attention", text: "Agent asked permission", code: "Bash: composer test", detail: undefined },
      { tone: "system", text: "Agent started", code: undefined, detail: undefined },
      { tone: "system", text: "Collected from GitHub", code: undefined, detail: undefined },
    ]);
  });

  it("describes assigning the issue on start", () => {
    const events = [ev("item.assigned", { assignee: "@me" }), ev("item.assign_failed", { reason: "HTTP 403" })];
    expect(timelineEntries(events, []).map(({ tone, text, detail }) => ({ tone, text, detail }))).toEqual([
      { tone: "attention", text: "Assigning the issue to you failed", detail: "HTTP 403" },
      { tone: "system", text: "Assigned the issue to you on GitHub", detail: undefined },
    ]);
  });

  it("describes restarts, resumes and removed worktrees", () => {
    const events = [
      ev("agent.interrupted", { reason: "daemon restarted" }),
      ev("agent.resumed", {}, { actor: "user" }),
      ev("worktree.removed", { path: "/wt", branch: "dp/1-x" }, { actor: "user" }),
    ];
    expect(timelineEntries(events, []).map(({ tone, text, detail }) => ({ tone, text, detail }))).toEqual([
      { tone: "user", text: "You removed the worktree", detail: "Branch dp/1-x kept" },
      { tone: "user", text: "You resumed the agent", detail: undefined },
      { tone: "attention", text: "Agent interrupted", detail: "daemon restarted" },
    ]);
  });

  it("keeps insertion order for events in the same instant", () => {
    const at = "2026-10-03T10:00:00Z";
    const events = [ev("draft.created", {}, { at, id: "first" }), ev("draft.edited", {}, { at, id: "second" })];
    expect(timelineEntries(events, []).map((e) => e.id)).toEqual(["second", "first"]);
  });
});

describe("timeLabel", () => {
  const now = new Date(2026, 9, 3, 12, 0);
  it.each([
    [new Date(2026, 9, 3, 9, 41), "09:41"],
    [new Date(2026, 9, 2, 17, 2), "Yesterday 17:02"],
    [new Date(2026, 8, 28, 17, 2), "Sep 28 17:02"],
  ])("%s", (d, label) => expect(timeLabel(d.toISOString(), now)).toBe(label));
});
