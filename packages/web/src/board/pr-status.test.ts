import { describe, expect, it } from "vitest";
import { prStatusChips } from "./pr-status";

const texts = (s: Parameters<typeof prStatusChips>[0]) => prStatusChips(s).map((c) => `${c.text}/${c.tone}`);

describe("prStatusChips (D47)", () => {
  it("shows conflicts, checks and the user's review", () => {
    expect(texts({ mergeable: "CONFLICTING", base: "main", checks: "FAILURE", viewerReview: "APPROVED" })).toEqual([
      "Conflicts/bad", "CI failed/bad", "You approved/ok",
    ]);
    expect(texts({ mergeable: "MERGEABLE", base: "main", checks: "PENDING" })).toEqual(["CI running/wait", "Not reviewed by you/plain"]);
  });

  it("keeps a value it does not know, and shows nothing without a status", () => {
    expect(texts({ mergeable: "UNKNOWN", base: "main", checks: "STALE", viewerReview: "DISMISSED" })).toEqual(["CI stale/plain", "You: dismissed/plain"]);
    expect(prStatusChips(undefined)).toEqual([]);
  });
});
