import { describe, expect, it } from "vitest";
import type { Event, EventType } from "../event/types.js";
import { prMergeOf } from "./pr-merge.js";

let n = 0;
const ev = (type: EventType, payload: Record<string, unknown> = {}): Event => ({
  id: `e-${++n}`, itemId: "item-1", at: "2026-10-03T12:00:00.000Z", actor: "system", type, payload,
});

describe("prMergeOf", () => {
  it("is not merged before anything was seen", () => {
    expect(prMergeOf([ev("draft.executed", { number: 45 })])).toEqual({ merged: false });
  });

  it("is merged after item.pr_merged or a removal for the merge", () => {
    expect(prMergeOf([ev("item.pr_merged")])).toEqual({ merged: true });
    expect(prMergeOf([ev("worktree.removed", { reason: "pr_merged" })])).toEqual({ merged: true });
  });

  it("does not count the user's removal as a merge", () => {
    expect(prMergeOf([ev("worktree.removed")])).toEqual({ merged: false });
  });

  it("names the latest skip until the worktree is removed", () => {
    const skipped = [ev("item.pr_merged"), ev("worktree.remove_skipped", { reason: "uncommitted changes" })];
    expect(prMergeOf(skipped)).toEqual({ merged: true, removeSkipped: "uncommitted changes" });
    expect(prMergeOf([...skipped, ev("worktree.removed")])).toEqual({ merged: true });
  });
});
