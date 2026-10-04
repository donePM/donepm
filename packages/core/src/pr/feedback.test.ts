import { describe, expect, it } from "vitest";
import type { Event } from "../event/types.js";
import { feedbackFixPrompt, newFeedback, prFeedbackOf, replyThreads, type FeedbackEntry } from "./feedback.js";

let n = 0;
const ev = (type: string, payload: Record<string, unknown> = {}): Event => {
  n++;
  return { id: `e${n}`, itemId: "i", at: `2026-10-04T10:${String(n).padStart(2, "0")}:00Z`, actor: "system", type: type as Event["type"], payload };
};
const pr = { number: 7, url: "https://github.com/o/r/pull/7" };
const review: FeedbackEntry = { kind: "review", id: 10, author: "ana", body: "", url: "https://github.com/o/r/pull/7#pullrequestreview-10", at: "2026-10-04T09:00:00Z", state: "CHANGES_REQUESTED" };
const inline: FeedbackEntry = {
  kind: "inline", id: 21, author: "ana", body: "Use a const here.", url: "https://github.com/o/r/pull/7#discussion_r21", at: "2026-10-04T09:00:00Z",
  path: "src/a.ts", line: 4, diffHunk: "@@ -1,3 +1,4 @@\n a\n+let b = 1", thread: 20,
};
const comment: FeedbackEntry = { kind: "comment", id: 10, author: "bo", body: "Does this cover Windows?", url: "https://github.com/o/r/pull/7#issuecomment-10", at: "2026-10-04T09:00:00Z" };

describe("prFeedbackOf", () => {
  it("waits on the user while nothing moved after the feedback", () => {
    expect(prFeedbackOf([ev("ci.passed"), ev("pr.feedback", { ...pr, entries: [review] }), ev("item.archived")])).toEqual({ pr, entries: [review], waiting: true });
  });

  it("stops waiting once the user dismissed it or the agent took it on", () => {
    expect(prFeedbackOf([ev("pr.feedback", { ...pr, entries: [] }), ev("pr.feedback_dismissed", pr)])).toMatchObject({ waiting: false });
    expect(prFeedbackOf([ev("pr.feedback", { ...pr, entries: [] }), ev("agent.resumed", { reason: "pr_feedback" })])).toMatchObject({ waiting: false });
    expect(prFeedbackOf([])).toBeUndefined();
  });
});

describe("newFeedback", () => {
  it("drops what an earlier pr.feedback recorded; ids count per kind", () => {
    const events = [ev("pr.feedback", { ...pr, entries: [review] })];
    expect(newFeedback([review, inline, comment], events)).toEqual([inline, comment]);
    expect(newFeedback([review], [])).toEqual([review]);
  });
});

describe("replyThreads", () => {
  it("lists the thread of every recorded inline comment", () => {
    expect([...replyThreads([ev("pr.feedback", { ...pr, entries: [review, inline, { ...inline, id: 30, thread: undefined }] })])]).toEqual([20, 30]);
  });
});

describe("feedbackFixPrompt", () => {
  it("names each reviewer, the file and line and thread of inline comments, and how to answer", () => {
    const p = feedbackFixPrompt({ pr, entries: [review, inline, comment] });
    expect(p).toContain("Pull request #7 got review feedback");
    expect(p).toContain("@ana requested changes");
    expect(p).toContain("`src/a.ts:4` (thread 20)");
    expect(p).toContain("+let b = 1");
    expect(p).toContain("@bo commented\nDoes this cover Windows?");
    expect(p).toContain("draft_push");
    expect(p).toContain("draft_comment");
    expect(p).not.toContain("git merge");
  });

  it("merges what only the PR branch on GitHub has first, e.g. a committed suggestion (#121)", () => {
    const p = feedbackFixPrompt({ pr, entries: [review] }, "dp/7-fix");
    expect(p).toContain("`origin/dp/7-fix` is fetched");
    expect(p.indexOf("git merge origin/dp/7-fix")).toBeGreaterThan(-1);
    expect(p.indexOf("git merge origin/dp/7-fix")).toBeLessThan(p.indexOf("Address what you agree with"));
  });
});
