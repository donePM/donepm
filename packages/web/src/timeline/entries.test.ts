import type { Event, PermissionAsk } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { timeLabel, timelineEntries } from "./entries";

let n = 0;
const ev = (type: string, payload: Record<string, unknown> = {}, over: Partial<Event> = {}): Event => {
  n++;
  return { id: `e${n}`, itemId: "i", at: `2026-10-03T09:${String(n).padStart(2, "0")}:00Z`, actor: "system", type: type as Event["type"], payload, ...over };
};
const ask: PermissionAsk = { id: "a1", itemId: "i", requestId: "r", toolName: "Bash", input: { command: "composer test" }, state: "allowed", rules: [] };

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

  it("names the rules of an allow for the run and the daemon's own answers", () => {
    const web: PermissionAsk = { id: "a2", itemId: "i", requestId: "r2", toolName: "WebFetch", input: { url: "https://nodejs.org/en" }, state: "allowed", rules: [] };
    const events = [
      ev("permission.answered", { behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "curl *" }] }, { refId: "a1", actor: "user" }),
      ev("permission.auto_allowed", { toolName: "WebFetch", host: "nodejs.org", domain: "nodejs.org" }, { refId: "a2" }),
    ];
    expect(timelineEntries(events, [ask, web]).map(({ tone, text, code, detail }) => ({ tone, text, code, detail }))).toEqual([
      { tone: "system", text: "Allowed web access on your list", code: "WebFetch: https://nodejs.org/en", detail: "nodejs.org is in Settings → Web access" },
      { tone: "user", text: "You allowed for this run", code: "Bash: composer test", detail: "Also allowed until the run ends: Bash: curl *" },
    ]);
  });

  it("keeps a multi-line command whole in the tooltip", () => {
    const long: PermissionAsk = { ...ask, input: { command: "pnpm build \\\n  && pnpm test" } };
    const [asked] = timelineEntries([ev("permission.asked", { toolName: "Bash" }, { refId: "a1", actor: "agent" })], [long]);
    expect(asked).toMatchObject({ code: "Bash: pnpm build \\", full: "pnpm build \\\n  && pnpm test" });
    const [short] = timelineEntries([ev("permission.asked", { toolName: "Bash" }, { refId: "a1", actor: "agent" })], [ask]);
    expect(short!.full).toBeUndefined();
  });

  it("shows questions and the user's answers", () => {
    const q: PermissionAsk = {
      id: "q1", itemId: "i", requestId: "r3", toolName: "AskUserQuestion", state: "allowed", rules: [],
      input: { questions: [{ question: "Which color?", header: "Color", options: [] }, { question: "Which sizes?", options: [] }] },
    };
    const events = [
      ev("permission.asked", { toolName: "AskUserQuestion" }, { refId: "q1", actor: "agent" }),
      ev("permission.answered", { behavior: "allow", rules: [], answers: { "Which sizes?": "S, L", "Which color?": "Green" } }, { refId: "q1", actor: "user" }),
      ev("permission.answered", { behavior: "deny" }, { refId: "q1", actor: "user" }),
    ];
    expect(timelineEntries(events, [q]).map(({ tone, text, code, detail }) => ({ tone, text, code, detail }))).toEqual([
      { tone: "user", text: "You declined the questions", code: "Which color? (+1 more)", detail: undefined },
      { tone: "user", text: "You answered", code: "Which color? (+1 more)", detail: "Color: Green · Which sizes?: S, L" },
      { tone: "attention", text: "Agent asked you", code: "Which color? (+1 more)", detail: undefined },
    ]);
  });

  it("describes the CI wait and push drafts", () => {
    const events = [
      ev("draft.executed", { url: "https://github.com/o/r/pull/7", number: 7 }, { refId: "d1" }),
      ev("ci.started", { number: 7, url: "u" }, { refId: "d1" }),
      ev("ci.failed", { number: 7, failed: [{ name: "test" }, { name: "lint" }], logs: [] }),
      ev("ci.started", { number: 7, reason: "rerun", runs: ["1"] }, { actor: "user" }),
      ev("ci.failed", { number: 7, failed: [{ name: "test" }], logs: [] }),
      ev("agent.resumed", { reason: "ci_failed" }, { actor: "user" }),
      ev("draft.created", { type: "push", title: "Push 1 commit to PR #7" }, { refId: "d2", actor: "agent" }),
      ev("draft.approved", {}, { refId: "d2", actor: "user" }),
      ev("draft.executed", { sha: "c0ffee1234" }, { refId: "d2" }),
      ev("ci.passed", { number: 7, checks: 3 }),
      ev("ci.marked_done", {}, { actor: "user" }),
      ev("ci.passed", { number: 8, checks: 0 }),
    ];
    expect(timelineEntries(events, []).map(({ tone, text, code, detail }) => ({ tone, text, code, detail })).reverse()).toEqual([
      { tone: "system", text: "Pull request created", code: undefined, detail: "https://github.com/o/r/pull/7" },
      { tone: "system", text: "Waiting for CI on PR #7", code: undefined, detail: undefined },
      { tone: "attention", text: "CI failed", code: undefined, detail: "test, lint" },
      { tone: "user", text: "You reran the failed jobs on PR #7", code: undefined, detail: undefined },
      { tone: "attention", text: "CI failed", code: undefined, detail: "test" },
      { tone: "user", text: "You let the agent fix the failed CI", code: undefined, detail: undefined },
      { tone: "attention", text: "Agent created push draft", code: undefined, detail: "Push 1 commit to PR #7" },
      { tone: "user", text: "You approved the push draft", code: undefined, detail: undefined },
      { tone: "system", text: "Commits pushed", code: "c0ffee1", detail: undefined },
      { tone: "system", text: "CI passed, done", code: undefined, detail: undefined },
      { tone: "user", text: "You marked it done without green CI", code: undefined, detail: undefined },
      { tone: "system", text: "PR #8 has no CI, done", code: undefined, detail: undefined },
    ]);
  });

  it("describes items closed upstream", () => {
    const events = [ev("item.closed_upstream"), ev("item.dismissed", {}, { actor: "user" })];
    expect(timelineEntries(events, []).map(({ tone, text }) => ({ tone, text }))).toEqual([
      { tone: "user", text: "You dismissed it after it was closed on GitHub" },
      { tone: "system", text: "Closed on GitHub, moved to Done" },
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

  it("describes a merged PR and what happened to its worktree", () => {
    const events = [
      ev("item.pr_merged", { number: 45, url: "https://github.com/acme/widgets/pull/45" }),
      ev("worktree.remove_skipped", { reason: "uncommitted changes", files: ["notes.md", "src/a.ts"], number: 45 }),
      ev("worktree.removed", { path: "/wt", branch: "dp/45-x", reason: "pr_merged", number: 45 }),
      ev("worktree.removed", { reason: "pr_merged" }),
    ];
    expect(timelineEntries(events, []).map(({ tone, text, detail }) => ({ tone, text, detail }))).toEqual([
      { tone: "system", text: "PR merged, worktree removed", detail: undefined },
      { tone: "system", text: "PR #45 merged, worktree removed", detail: "Branch dp/45-x kept" },
      { tone: "attention", text: "Worktree not removed", detail: "uncommitted changes: notes.md, src/a.ts" },
      { tone: "system", text: "PR #45 merged", detail: undefined },
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
