import { describe, expect, it } from "vitest";
import type { FeedbackEntry } from "../api/types";
import { replyTarget } from "./replies";

const inline = (over: Partial<FeedbackEntry>): FeedbackEntry => ({ kind: "inline", id: 1, author: "ana", body: "x", url: "u", at: "t", ...over });

describe("replyTarget", () => {
  it("names the thread's first comment, its file and line", () => {
    const feedback = [inline({ id: 41, thread: 41, path: "src/a.ts", line: 12 }), inline({ id: 42, thread: 41, author: "bo" })];
    expect(replyTarget({ body: "b", inReplyTo: 41 }, feedback)).toBe("Reply to @ana on src/a.ts:12");
  });

  it("falls back to a later comment in the thread, then to the number", () => {
    expect(replyTarget({ body: "b", inReplyTo: 41 }, [inline({ id: 42, thread: 41, author: "bo", path: "b.ts" })])).toBe("Reply to @bo on b.ts");
    expect(replyTarget({ body: "b", inReplyTo: 9 }, [])).toBe("Reply in thread 9");
  });

  it("is a PR comment without a thread", () => {
    expect(replyTarget({ body: "b" }, [])).toBe("Comment on the pull request");
  });
});
