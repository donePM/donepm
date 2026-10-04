import { describe, expect, it } from "vitest";
import { draftTitle, type Draft } from "./types.js";

const base = { id: "d", itemId: "i", state: "pending" as const };
const push = { summary: "s", number: 7, url: "u", branch: "b", commits: [{ sha: "a", subject: "x" }], uncommitted: false };

describe("draftTitle", () => {
  it("counts the replies a push or comment draft posts", () => {
    expect(draftTitle({ ...base, type: "push", payload: push } as Draft)).toBe("Push 1 commit to PR #7");
    expect(draftTitle({ ...base, type: "push", payload: { ...push, replies: [{ body: "a" }, { body: "b" }] } } as Draft)).toBe(
      "Push 1 commit to PR #7, reply 2 times",
    );
    expect(draftTitle({ ...base, type: "comment", payload: { number: 7, url: "u", replies: [{ body: "a", inReplyTo: 3 }] } } as Draft)).toBe(
      "Reply 1 time on PR #7",
    );
  });

  it("names a review draft by its verdict and inline comments", () => {
    const review = { number: 12, url: "u", commitId: "c", body: "b", comments: [] };
    expect(draftTitle({ ...base, type: "review", payload: { ...review, verdict: "APPROVE" } } as Draft)).toBe("Approve PR #12");
    expect(draftTitle({ ...base, type: "review", payload: { ...review, verdict: "COMMENT" } } as Draft)).toBe("Comment on PR #12");
    const comments = [{ path: "a.ts", line: 1, body: "x" }, { path: "b.ts", line: 2, body: "y" }];
    expect(draftTitle({ ...base, type: "review", payload: { ...review, verdict: "REQUEST_CHANGES", comments } } as Draft)).toBe(
      "Request changes on PR #12, 2 inline comments",
    );
  });
});
