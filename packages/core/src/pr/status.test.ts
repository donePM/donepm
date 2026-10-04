import { describe, expect, it } from "vitest";
import type { WorkItem } from "../item/types.js";
import { InvalidTransitionError } from "../item/transitions.js";
import { conflictComment, prCommented, prConflicts, withPrStatus, type PrStatus } from "./status.js";

const ctx = { now: () => "2026-10-04T12:00:00.000Z", newId: () => "id" };
const item: WorkItem = {
  id: "i", source: "github-pr", externalId: "o/r#9", externalUrl: "u", title: "t", body: "", labels: [],
  state: "done", playbook: "review", priority: 2, stateSince: "a", createdAt: "a", updatedAt: "a",
};
const status: PrStatus = { mergeable: "MERGEABLE", base: "main", checks: "SUCCESS" };

describe("withPrStatus (D47)", () => {
  it("stores a new or changed status and nothing when it is the same", () => {
    const first = withPrStatus(item, status, ctx);
    expect(first).toMatchObject({ prStatus: status, updatedAt: "2026-10-04T12:00:00.000Z", state: "done" });
    expect(withPrStatus(first!, { ...status }, ctx)).toBeUndefined();
    expect(withPrStatus(first!, { ...status, viewerReview: "APPROVED" }, ctx)?.prStatus?.viewerReview).toBe("APPROVED");
  });

  it("leaves issues alone", () => {
    expect(withPrStatus({ ...item, source: "github-issue" }, status, ctx)).toBeUndefined();
  });
});

describe("conflicts (D47)", () => {
  it("knows a conflicting pull request", () => {
    expect(prConflicts({ prStatus: { ...status, mergeable: "CONFLICTING" } })).toBe(true);
    expect(prConflicts({ prStatus: { ...status, mergeable: "UNKNOWN" } })).toBe(false);
    expect(prConflicts({})).toBe(false);
  });

  it("asks Dependabot to rebase and a person to resolve", () => {
    expect(conflictComment({ author: "dependabot[bot]" })).toBe("@dependabot rebase");
    expect(conflictComment({ author: "octo", prStatus: status })).toBe("This pull request has conflicts with `main`. Could you resolve them?");
  });
});

describe("prCommented (D47)", () => {
  it("records the comment as the user's, without changing the state", () => {
    const t = prCommented(item, ctx, "@dependabot rebase");
    expect(t.item).toMatchObject({ state: "done", updatedAt: "2026-10-04T12:00:00.000Z" });
    expect(t.events).toEqual([
      { id: "id", itemId: "i", at: "2026-10-04T12:00:00.000Z", actor: "user", type: "pr.commented", payload: { body: "@dependabot rebase" } },
    ]);
  });

  it("refuses an issue", () => {
    expect(() => prCommented({ ...item, source: "github-issue" }, ctx, "x")).toThrow(InvalidTransitionError);
  });
});
