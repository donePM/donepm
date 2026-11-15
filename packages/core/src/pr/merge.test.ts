import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../item/transitions.js";
import type { WorkItem } from "../item/types.js";
import { autoMergeDue, autoMergeFailed, autoMergeOn, autoMergeSet, mergeBlockers, mergeFailurePasses } from "./merge.js";
import type { PrStatus } from "./status.js";

const ctx = { now: () => "2026-10-04T12:00:00.000Z", newId: () => "id" };
const ready: PrStatus = { state: "OPEN", mergeable: "MERGEABLE", mergeState: "CLEAN", head: "abc", base: "main", viewerReview: "APPROVED", checks: "SUCCESS" };
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

  it("waits for a branch that is behind its base to be updated", () => {
    expect(mergeBlockers({ ...item, prStatus: { ...ready, mergeState: "BEHIND" } })).toEqual(["the branch is behind main; waiting for it to be updated"]);
    for (const mergeState of ["CLEAN", "UNSTABLE", "HAS_HOOKS", "UNKNOWN", undefined]) {
      expect(mergeBlockers({ ...item, prStatus: { ...ready, mergeState } })).toEqual([]);
    }
  });

  it("refuses closed, unread and issue items", () => {
    expect(mergeBlockers({ ...item, prStatus: { ...ready, state: "MERGED" } })).toEqual(["pull request is merged"]);
    expect(mergeBlockers({ ...item, prStatus: undefined })).toEqual(["status not read yet"]);
    expect(mergeBlockers({ ...item, source: "github-issue" })).toEqual(["not someone else's pull request"]);
  });
});

describe("mergeFailurePasses (D47)", () => {
  it("knows refusals that pass on their own", () => {
    for (const error of [
      "X Pull request donePM/donepm#85 is not mergeable: the head branch is not up to date with the base branch.\nTo have the pull request merged after all the requirements have been met, add the `--auto` flag.",
      "GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)",
      "GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)",
      "GraphQL: Required status check \"test\" is expected. (mergePullRequest)",
      "GraphQL: Required status checks are pending (mergePullRequest)",
      "Pull request mergeability is unknown, try again",
    ]) expect(mergeFailurePasses(error)).toBe(true);
  });

  it("treats anything else as a refusal", () => {
    for (const error of [
      "X Pull request o/r#1 is not mergeable: the merge commit cannot be cleanly created.",
      "GraphQL: Resource not accessible by integration (mergePullRequest)",
      "Pull request is in clean status, merge queue required",
      "GraphQL: Squash merges are not allowed on this repository. (mergePullRequest)",
      "",
    ]) expect(mergeFailurePasses(error)).toBe(false);
  });
});

describe("auto-merge (D47)", () => {
  it("follows the repository unless the item says otherwise", () => {
    expect(autoMergeOn({}, true)).toBe(true);
    expect(autoMergeOn({ autoMerge: false }, true)).toBe(false);
    expect(autoMergeOn({ autoMerge: true }, false)).toBe(true);
  });

  it("records the user's choice, and turns itself off after a refusal", () => {
    const on = autoMergeSet(item, ctx, true);
    expect(on.item.autoMerge).toBe(true);
    expect(on.events[0]).toMatchObject({ type: "pr.auto_merge_set", actor: "user", payload: { on: true } });
    const failed = autoMergeFailed(on.item, ctx, { method: "squash", error: "Squash merges are not allowed" });
    expect(failed.item).toMatchObject({ autoMerge: false, state: "done" });
    expect(failed.item.autoMergeHeld).toBeUndefined();
    expect(failed.events[0]).toMatchObject({
      type: "pr.merge_failed", actor: "system", payload: { method: "squash", error: "Squash merges are not allowed", auto: true, staysOn: false },
    });
  });

  it("stays on after a refusal that passes, held until the head or merge state changes", () => {
    const behind = "X Pull request o/r#9 is not mergeable: the head branch is not up to date with the base branch.";
    for (const autoMerge of [true, undefined]) {
      const failed = autoMergeFailed({ ...item, autoMerge }, ctx, { method: "squash", error: behind });
      expect(failed.item.autoMerge).toBe(autoMerge);
      expect(failed.item.autoMergeHeld).toEqual({ head: "abc", mergeState: "CLEAN" });
      expect(failed.events[0]).toMatchObject({ type: "pr.merge_failed", payload: { auto: true, staysOn: true, error: behind } });
    }
    const held = autoMergeFailed({ ...item, autoMerge: true }, ctx, { method: "squash", error: behind }).item;
    expect(autoMergeDue(held, false)).toBe(false);
    expect(autoMergeDue({ ...held, prStatus: { ...ready, head: "def" } }, false)).toBe(true);
    expect(autoMergeDue({ ...held, prStatus: { ...ready, mergeState: "UNSTABLE" } }, false)).toBe(true);
    // Ticking the box again lets it try at once.
    expect(autoMergeSet(held, ctx, true).item.autoMergeHeld).toBeUndefined();
  });

  it("is due when it is on and nothing blocks the merge", () => {
    expect(autoMergeDue({ ...item, autoMerge: true }, false)).toBe(true);
    expect(autoMergeDue(item, true)).toBe(true);
    expect(autoMergeDue(item, false)).toBe(false);
    expect(autoMergeDue({ ...item, autoMerge: true, prStatus: { ...ready, mergeState: "BEHIND" } }, false)).toBe(false);
  });

  it("refuses an issue", () => {
    expect(() => autoMergeSet({ ...item, source: "github-issue" }, ctx, true)).toThrow(InvalidTransitionError);
  });
});
