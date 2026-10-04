import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../item/transitions.js";
import type { WorkItem } from "../item/types.js";
import { autoMergeFailed, autoMergeOn, autoMergeSet, mergeBlockers } from "./merge.js";
import type { PrStatus } from "./status.js";

const ctx = { now: () => "2026-10-04T12:00:00.000Z", newId: () => "id" };
const ready: PrStatus = { state: "OPEN", mergeable: "MERGEABLE", base: "main", viewerReview: "APPROVED", checks: "SUCCESS" };
const item: WorkItem = {
  id: "i", source: "github-pr", externalId: "o/r#9", externalUrl: "u", title: "t", body: "", labels: [],
  state: "done", playbook: "review", priority: 2, stateSince: "a", createdAt: "a", updatedAt: "a", prStatus: ready,
};

describe("mergeBlockers (D47)", () => {
  it("is empty once the user approved, the checks passed and GitHub says mergeable", () => {
    expect(mergeBlockers(item)).toEqual([]);
    expect(mergeBlockers({ ...item, state: "ready" })).toEqual([]);
    const { checks: _none, ...noChecks } = ready;
    expect(mergeBlockers({ ...item, prStatus: noChecks })).toEqual([]);
  });

  it("names every condition that does not hold", () => {
    expect(mergeBlockers({ ...item, state: "needs_you", prStatus: { ...ready, viewerReview: "COMMENTED", checks: "PENDING", mergeable: "CONFLICTING" } })).toEqual([
      "the item is busy or waits on you", "you have not approved it", "checks have not passed", "it has conflicts",
    ]);
    expect(mergeBlockers({ ...item, prStatus: { ...ready, mergeable: "UNKNOWN" } })).toEqual(["GitHub has not said it is mergeable"]);
  });

  it("refuses closed, unread and issue items", () => {
    expect(mergeBlockers({ ...item, prStatus: { ...ready, state: "MERGED" } })).toEqual(["pull request is merged"]);
    expect(mergeBlockers({ ...item, prStatus: undefined })).toEqual(["status not read yet"]);
    expect(mergeBlockers({ ...item, source: "github-issue" })).toEqual(["not someone else's pull request"]);
  });
});

describe("auto-merge (D47)", () => {
  it("follows the repository unless the item says otherwise", () => {
    expect(autoMergeOn({}, true)).toBe(true);
    expect(autoMergeOn({ autoMerge: false }, true)).toBe(false);
    expect(autoMergeOn({ autoMerge: true }, false)).toBe(true);
  });

  it("records the user's choice, and turns itself off after a failure", () => {
    const on = autoMergeSet(item, ctx, true);
    expect(on.item.autoMerge).toBe(true);
    expect(on.events[0]).toMatchObject({ type: "pr.auto_merge_set", actor: "user", payload: { on: true } });
    const failed = autoMergeFailed(on.item, ctx, { method: "squash", error: "Squash merges are not allowed" });
    expect(failed.item).toMatchObject({ autoMerge: false, state: "done" });
    expect(failed.events[0]).toMatchObject({ type: "pr.merge_failed", actor: "system", payload: { method: "squash", error: "Squash merges are not allowed", auto: true } });
  });

  it("refuses an issue", () => {
    expect(() => autoMergeSet({ ...item, source: "github-issue" }, ctx, true)).toThrow(InvalidTransitionError);
  });
});
