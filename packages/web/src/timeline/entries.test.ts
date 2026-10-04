import type { Event, PermissionAsk } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { spanText, splitActor, timeLabel, timelineEntries } from "./entries";

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
      { tone: "system", text: "Agent turn ended", code: undefined, detail: "3 min · $0.86" },
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
      { tone: "user", text: "You allowed for this run", code: "Bash: composer test", detail: "Also allowed until the run ends: Bash commands matching curl *" },
    ]);
  });

  it("shows always allow, its grant, the answers it gave and its removal (D38)", () => {
    const later: PermissionAsk = { ...ask, id: "a2", input: { command: "pnpm test core" } };
    const g = { grantId: "g1", repo: "github.com/o/r", toolName: "Bash", ruleContent: "pnpm test *" };
    const events = [
      ev("permission.answered", { behavior: "allow", rules: [], always: [g] }, { refId: "a1", actor: "user" }),
      ev("permission.granted", { ...g, askId: "a1" }, { refId: "g1", actor: "user" }),
      ev("permission.auto_allowed", { toolName: "Bash", repo: "github.com/o/r", grants: [{ grantId: "g1", toolName: "Bash", ruleContent: "pnpm test *" }] }, { refId: "a2" }),
      ev("permission.grant_revoked", g, { refId: "g1", actor: "user" }),
    ];
    expect(timelineEntries(events, [ask, later]).map(({ tone, text, code, detail }) => ({ tone, text, code, detail }))).toEqual([
      { tone: "user", text: "You removed from Always allowed in o/r", code: "Bash(pnpm test *)", detail: undefined },
      { tone: "system", text: "Always allowed in o/r", code: "Bash: pnpm test core", detail: "Bash(pnpm test *) is in Settings → Always allowed" },
      { tone: "user", text: "Added to Always allowed in o/r", code: "Bash(pnpm test *)", detail: undefined },
      { tone: "user", text: "You always allowed", code: "Bash: composer test", detail: undefined },
    ]);
  });

  it("keeps a multi-line command whole in the tooltip", () => {
    const long: PermissionAsk = { ...ask, input: { command: "pnpm build \\\n  && pnpm test" } };
    const [asked] = timelineEntries([ev("permission.asked", { toolName: "Bash" }, { refId: "a1", actor: "agent" })], [long]);
    expect(asked).toMatchObject({ code: "Bash: pnpm build && pnpm test", full: "pnpm build \\\n  && pnpm test" });
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

  it("describes merge conflicts", () => {
    const events = [
      ev("pr.conflicted", { number: 7, url: "u", base: "main", files: ["a.ts", "b.ts"], from: "done" }),
      ev("agent.resumed", { reason: "pr_conflict" }, { actor: "user" }),
      ev("pr.conflicted", { number: 7, url: "u", base: "main", files: [], from: "checking" }),
      ev("pr.conflict_dismissed", { number: 7, url: "u" }, { actor: "user" }),
      ev("pr.conflict_resolved", { number: 7, url: "u" }),
    ];
    expect(timelineEntries(events, []).map(({ tone, text, detail }) => ({ tone, text, detail })).reverse()).toEqual([
      { tone: "attention", text: "PR #7 has merge conflicts with main", detail: "a.ts, b.ts" },
      { tone: "user", text: "You let the agent resolve the merge conflict", detail: undefined },
      { tone: "attention", text: "PR #7 has merge conflicts with main", detail: undefined },
      { tone: "user", text: "You'll resolve the merge conflict yourself", detail: undefined },
      { tone: "system", text: "PR #7 can be merged again", detail: undefined },
    ]);
  });

  it("describes review feedback and the replies to it", () => {
    const entries = [
      { kind: "review", id: 1, author: "ana", body: "", url: "u", at: "t" },
      { kind: "inline", id: 2, author: "ana", body: "x", url: "u", at: "t" },
      { kind: "comment", id: 3, author: "bo", body: "y", url: "u", at: "t" },
    ];
    const events = [
      ev("pr.feedback", { number: 7, url: "u", entries }),
      ev("agent.resumed", { reason: "pr_feedback" }, { actor: "user" }),
      ev("draft.created", { type: "push", title: "Push 1 commit to PR #7, reply 2 times" }, { refId: "p", actor: "agent" }),
      ev("draft.executed", { sha: "abcdef123", posted: [{ index: 0, url: "a" }, { index: 1, url: "b" }] }, { refId: "p" }),
      ev("draft.created", { type: "comment", title: "Reply 1 time on PR #7" }, { refId: "c", actor: "agent" }),
      ev("draft.execution_failed", { step: "reply", error: "HTTP 403" }, { refId: "c" }),
      ev("draft.executed", { posted: [{ index: 0, url: "a" }] }, { refId: "c" }),
      ev("pr.feedback_dismissed", { number: 7, url: "u" }, { actor: "user" }),
    ];
    expect(timelineEntries(events, []).map(({ tone, text, detail }) => ({ tone, text, detail })).reverse()).toEqual([
      { tone: "attention", text: "Review feedback on PR #7", detail: "3 from @ana, @bo" },
      { tone: "user", text: "You let the agent address the review feedback", detail: undefined },
      { tone: "attention", text: "Agent created push draft", detail: "Push 1 commit to PR #7, reply 2 times" },
      { tone: "system", text: "Commits pushed, 2 replies posted", detail: undefined },
      { tone: "attention", text: "Agent created reply draft", detail: "Reply 1 time on PR #7" },
      { tone: "danger", text: "Posting the replies failed", detail: "HTTP 403" },
      { tone: "system", text: "1 reply posted, done", detail: undefined },
      { tone: "user", text: "You marked the review feedback done", detail: undefined },
    ]);
  });

  it("describes a comment the user posted from the card (D47)", () => {
    const [entry] = timelineEntries([ev("pr.commented", { body: "@dependabot rebase" }, { actor: "user" })], []);
    expect(entry).toMatchObject({ tone: "user", text: "You commented on the pull request", detail: "@dependabot rebase" });
  });

  it("describes merging someone else's pull request (D47)", () => {
    const entries = timelineEntries([
      ev("pr.auto_merge_set", { on: true }, { actor: "user" }),
      ev("pr.merge_failed", { method: "squash", auto: true, error: "merge queue required" }),
      ev("pr.merge_failed", { method: "squash", auto: true, staysOn: true, error: "not up to date with the base branch" }),
      ev("pr.merged", { method: "rebase", auto: false }, { actor: "user" }),
      ev("pr.merged", { method: "squash", auto: true }),
    ], []);
    // Newest first.
    expect(entries.map((e) => [e.tone, e.text, e.detail])).toEqual([
      ["system", "Merged automatically (squash)", undefined],
      ["user", "You merged the pull request (rebase)", undefined],
      ["attention", "Automatic merge failed, stays on and tries again once the pull request changes", "not up to date with the base branch"],
      ["danger", "Automatic merge failed, turned off for this item", "merge queue required"],
      ["user", "You turned on automatic merge", undefined],
    ]);
  });

  it("describes a review of someone else's pull request (D43)", () => {
    const events = [
      ev("draft.created", { type: "review", title: "Approve PR #7" }, { refId: "r", actor: "agent" }),
      ev("draft.execution_failed", { step: "review", error: "HTTP 422" }, { refId: "r" }),
      ev("draft.executed", { id: 1, url: "https://github.com/o/r/pull/7#pullrequestreview-1" }, { refId: "r" }),
    ];
    expect(timelineEntries(events, []).map(({ tone, text, detail }) => ({ tone, text, detail })).reverse()).toEqual([
      { tone: "attention", text: "Agent created review draft", detail: "Approve PR #7" },
      { tone: "danger", text: "Posting the review failed", detail: "HTTP 422" },
      { tone: "system", text: "Review posted, done", detail: "https://github.com/o/r/pull/7#pullrequestreview-1" },
    ]);
  });

  it("describes updating the branch of someone else's pull request (issue #148)", () => {
    const events = [
      ev("draft.created", { type: "update_branch", title: "Update the branch of PR #7" }, { refId: "u", actor: "agent" }),
      ev("draft.execution_failed", { step: "update_branch", error: "HTTP 422" }, { refId: "u" }),
      ev("draft.executed", { via: "update-branch" }, { refId: "u" }),
      ev("pr.branch_updated", { via: "dependabot" }, { actor: "user" }),
      ev("pr.branch_updated", { via: "update-branch" }, { actor: "user" }),
    ];
    expect(timelineEntries(events, []).map(({ tone, text, detail }) => ({ tone, text, detail })).reverse()).toEqual([
      { tone: "attention", text: "Agent created update-branch draft", detail: "Update the branch of PR #7" },
      { tone: "danger", text: "Updating the branch failed", detail: "HTTP 422" },
      { tone: "system", text: "Branch update requested, the agent goes on", detail: undefined },
      { tone: "user", text: "You asked Dependabot to rebase the branch", detail: undefined },
      { tone: "user", text: "You updated the branch with its base", detail: undefined },
    ]);
  });

  it("describes items closed upstream", () => {
    const events = [ev("item.closed_upstream"), ev("item.dismissed", {}, { actor: "user" })];
    expect(timelineEntries(events, []).map(({ tone, text }) => ({ tone, text }))).toEqual([
      { tone: "user", text: "You dismissed it after it was closed on GitHub" },
      { tone: "system", text: "Closed on GitHub, moved to Done" },
    ]);
  });

  it("describes archiving a finished item", () => {
    expect(timelineEntries([ev("item.archived", { finishedAt: "2026-10-01T00:00:00Z" })], [])[0]).toMatchObject({
      tone: "system",
      text: "Moved to the Archive",
    });
  });

  it("describes changes taken over from GitHub (D45)", () => {
    const only = ev("item.refreshed", { changed: { priority: { from: 2, to: 1 } } });
    const all = ev("item.refreshed", {
      changed: {
        priority: { from: 3, to: 0 },
        title: { from: "Old", to: "New" },
        labels: { from: ["P3", "bug"], to: ["bug", "urgent"] },
      },
    });
    const labelsOnly = ev("item.refreshed", { changed: { labels: { from: [], to: ["docs"] } } });
    expect(timelineEntries([only, all, labelsOnly], []).map(({ tone, text, detail }) => ({ tone, text, detail }))).toEqual([
      { tone: "system", text: "Changed on GitHub: labels +docs", detail: undefined },
      { tone: "system", text: "Changed on GitHub: priority P3 → P0, title, labels +urgent −P3", detail: "“Old” → “New”" },
      { tone: "system", text: "Priority changed on GitHub: P2 → P1", detail: undefined },
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

  it("shows a moved worktree with its new path", () => {
    const events = [ev("worktree.moved", { from: "/old/r/dp-1-x", to: "/new/r/dp-1-x" }, { actor: "user" })];
    expect(timelineEntries(events, []).map(({ tone, text, detail }) => ({ tone, text, detail }))).toEqual([
      { tone: "user", text: "You moved the worktree", detail: "to /new/r/dp-1-x" },
    ]);
  });

  it("keeps insertion order for events in the same instant", () => {
    const at = "2026-10-03T10:00:00Z";
    const events = [ev("draft.created", {}, { at, id: "first" }), ev("draft.edited", {}, { at, id: "second" })];
    expect(timelineEntries(events, []).map((e) => e.id)).toEqual(["second", "first"]);
  });
});

describe("turn details", () => {
  it("shows how long a turn took, the cost and the tokens", () => {
    const events = [
      ev("agent.turn_started", {}, { at: "2026-10-03T09:30:00Z" }),
      ev("agent.turn_ended", { costUsd: 0.86, usage: { inputTokens: 48_200, outputTokens: 6_100 } }, { at: "2026-10-03T09:41:00Z" }),
    ];
    expect(timelineEntries(events, [])[0]?.detail).toBe("11 min · $0.86 · 48.2k in / 6.1k out");
  });

  it("spells durations short", () => {
    expect(spanText(4_000)).toBe("4 s");
    expect(spanText(11 * 60_000)).toBe("11 min");
    expect(spanText(65 * 60_000)).toBe("1 h 5 min");
    expect(spanText(120 * 60_000)).toBe("2 h");
  });
});

describe("splitActor", () => {
  it("puts who did it first, in its own field", () => {
    expect(splitActor("You allowed", "user")).toEqual({ actor: "You", verb: "allowed" });
    expect(splitActor("Agent created PR draft", "agent")).toEqual({ actor: "Agent", verb: "created PR draft" });
    expect(splitActor("Agent started", "user")).toEqual({ actor: "You", verb: "started" });
    expect(splitActor("Collected from GitHub", "system")).toEqual({ actor: "System", verb: "collected from GitHub" });
    expect(splitActor("CI passed", "system")).toEqual({ actor: "System", verb: "CI passed" });
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
