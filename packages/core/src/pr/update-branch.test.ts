import { describe, expect, it } from "vitest";
import { branchUpdatePosted, InvalidTransitionError } from "../item/transitions.js";
import type { WorkItem } from "../item/types.js";
import type { PrStatus } from "./status.js";
import { branchUpdateBlocker, branchUpdatedMessage, branchUpdateVia, prBranchUpdated } from "./update-branch.js";

const ctx = { now: () => "2026-10-04T12:00:00.000Z", newId: () => "id" };
const behind: PrStatus = { state: "OPEN", mergeable: "MERGEABLE", mergeState: "BEHIND", head: "abc", base: "main" };
const item: WorkItem = {
  id: "i", source: "github-pr", externalId: "o/r#9", externalUrl: "u", title: "t", body: "", labels: [],
  state: "done", playbook: "review", priority: 2, stateSince: "a", createdAt: "a", updatedAt: "a", prStatus: behind,
};

describe("branchUpdateVia (#148)", () => {
  it("asks Dependabot to rebase and updates any other branch on GitHub", () => {
    expect(branchUpdateVia({ author: "dependabot[bot]" })).toBe("dependabot");
    expect(branchUpdateVia({ author: "octocat" })).toBe("update-branch");
    expect(branchUpdateVia({})).toBe("update-branch");
  });
});

describe("branchUpdateBlocker (#148)", () => {
  it("allows an open pull request that is behind its base", () => {
    expect(branchUpdateBlocker(item)).toBeUndefined();
  });

  it("says why anything else cannot be updated", () => {
    expect(branchUpdateBlocker({ ...item, prStatus: { ...behind, mergeState: "CLEAN" } })).toBe("the branch is not behind main");
    expect(branchUpdateBlocker({ ...item, prStatus: { ...behind, state: "MERGED" } })).toBe("pull request is merged");
    expect(branchUpdateBlocker({ ...item, prStatus: undefined })).toBe("status not read yet");
    expect(branchUpdateBlocker({ ...item, source: "github-issue" })).toBe("not someone else's pull request");
  });
});

describe("prBranchUpdated (#148)", () => {
  it("records the user's click and leaves the item where it is", () => {
    const t = prBranchUpdated(item, ctx, "dependabot");
    expect(t.item).toMatchObject({ state: "done", updatedAt: ctx.now() });
    expect(t.events).toEqual([{ id: "id", itemId: "i", at: ctx.now(), actor: "user", type: "pr.branch_updated", payload: { via: "dependabot" } }]);
    expect(() => prBranchUpdated({ ...item, source: "github-issue" }, ctx, "update-branch")).toThrow(InvalidTransitionError);
  });
});

describe("branchUpdatePosted (#148)", () => {
  it("runs the agent again after its approved draft ran, so it finishes the review", () => {
    const t = branchUpdatePosted({ ...item, state: "needs_you" }, ctx, "d", { via: "update-branch" });
    expect(t.item.state).toBe("running");
    expect(t.events[0]).toMatchObject({ type: "draft.executed", actor: "system", refId: "d", payload: { via: "update-branch" } });
    expect(() => branchUpdatePosted(item, ctx, "d")).toThrow(InvalidTransitionError);
  });

  it("tells the agent how the branch is updated and to go on", () => {
    expect(branchUpdatedMessage("dependabot", "main")).toContain("`@dependabot rebase` was posted");
    expect(branchUpdatedMessage("update-branch", "main")).toContain("GitHub merges `main` into the branch");
    expect(branchUpdatedMessage("update-branch", "main")).toContain("call draft_review once");
  });
});
