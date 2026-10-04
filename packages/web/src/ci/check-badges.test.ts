import { describe, expect, it } from "vitest";
import { checkBadges } from "./check-badges";

describe("checkBadges", () => {
  it("marks passed checks, failed ones, and how long a pending one runs", () => {
    const now = Date.parse("2026-01-01T10:01:20Z");
    expect(
      checkBadges(
        [
          { name: "tests", bucket: "pass" },
          { name: "lint", bucket: "fail" },
          { name: "types", bucket: "pending", startedAt: "2026-01-01T10:00:00Z" },
          { name: "build", bucket: "pending" },
          { name: "docs", bucket: "skipping" },
        ],
        now,
      ),
    ).toEqual([
      { name: "tests", text: "tests", tone: "ok", passed: true },
      { name: "lint", text: "lint", tone: "danger", passed: false },
      { name: "types", text: "types · 1:20", tone: "muted", passed: false },
      { name: "build", text: "build", tone: "muted", passed: false },
      { name: "docs", text: "docs", tone: "muted", passed: false },
    ]);
  });
});
