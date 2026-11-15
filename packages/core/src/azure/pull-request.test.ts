import { describe, expect, it } from "vitest";
import { AZURE_PR_DESCRIPTION_MAX, azurePrDescription, azurePrState } from "./pull-request.js";

describe("azurePrState (issue #141)", () => {
  it("maps active, completed and abandoned to open, merged and closed", () => {
    expect(azurePrState({ status: "active", mergeStatus: "succeeded", targetRefName: "refs/heads/main" }))
      .toEqual({ state: "OPEN", mergedAt: null, mergeable: "MERGEABLE", baseRefName: "main" });
    expect(azurePrState({ status: "completed", mergeStatus: "succeeded", closedDate: "2026-09-01T10:00:00Z" }))
      .toMatchObject({ state: "MERGED", mergedAt: "2026-09-01T10:00:00Z" });
    expect(azurePrState({ status: "abandoned", closedDate: "2026-09-01T10:00:00Z" })).toMatchObject({ state: "CLOSED", mergedAt: null });
  });

  it("reads a conflicting merge status as a conflict, and anything unsettled as unknown", () => {
    expect(azurePrState({ status: "active", mergeStatus: "conflicts" }).mergeable).toBe("CONFLICTING");
    for (const mergeStatus of ["queued", "notSet", "rejectedByPolicy", "failure", undefined]) {
      expect(azurePrState({ status: "active", mergeStatus }).mergeable).toBe("UNKNOWN");
    }
  });

  it("keeps a base branch outside refs/heads as it is", () => {
    expect(azurePrState({ status: "active", targetRefName: "release/2" }).baseRefName).toBe("release/2");
  });

  it("throws on a status it does not know", () => {
    expect(() => azurePrState({ status: "notSet" })).toThrow(/notSet/);
  });
});

describe("azurePrDescription", () => {
  it("keeps a description that fits", () => {
    expect(azurePrDescription("Fixes the build.")).toBe("Fixes the build.");
  });

  it("cuts a longer one to the limit and says so", () => {
    const cut = azurePrDescription("x".repeat(5000));
    expect(cut).toHaveLength(AZURE_PR_DESCRIPTION_MAX);
    expect(cut).toMatch(/shortened to fit/);
  });
});
