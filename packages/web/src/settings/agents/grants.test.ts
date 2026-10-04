import type { PermissionGrant } from "@donepm/core";
import { describe, expect, it } from "vitest";
import { groupGrants, usesText } from "./grants";

const grant = (id: string, repo: string, createdAt: string, extra: Partial<PermissionGrant> = {}): PermissionGrant => ({
  id, repo, toolName: "Bash", ruleContent: "pnpm test *", createdAt, askId: "a", itemId: "i", call: "Bash: pnpm test", useCount: 0, ...extra,
});

describe("groupGrants", () => {
  it("groups by repository name, oldest grant first, without removed ones", () => {
    const groups = groupGrants([
      grant("g1", "github.com/z/last", "2026-10-02T00:00:00.000Z"),
      grant("g2", "github.com/a/first", "2026-10-03T00:00:00.000Z"),
      grant("g3", "github.com/a/first", "2026-10-01T00:00:00.000Z", { toolName: "WebFetch", ruleContent: "domain:npmjs.org", useCount: 3, lastUsedAt: "2026-10-04T00:00:00.000Z" }),
      grant("g4", "github.com/a/first", "2026-10-01T00:00:00.000Z", { revokedAt: "2026-10-02T00:00:00.000Z" }),
    ]);
    expect(groups.map((g) => [g.name, g.rows.map((r) => r.id)])).toEqual([
      ["a/first", ["g3", "g2"]],
      ["z/last", ["g1"]],
    ]);
    expect(groups[0]!.rows[0]).toEqual({
      id: "g3", words: { text: "web and network access to", pattern: "npmjs.org" }, raw: "WebFetch(domain:npmjs.org)",
      createdAt: "2026-10-01T00:00:00.000Z", useCount: 3, lastUsedAt: "2026-10-04T00:00:00.000Z", call: "Bash: pnpm test",
    });
    expect(groups[0]!.rows[1]).toMatchObject({ words: { text: "Bash commands matching", pattern: "pnpm test *" }, raw: "Bash(pnpm test *)" });
  });

  it("is empty without grants", () => {
    expect(groupGrants([])).toEqual([]);
  });
});

describe("usesText", () => {
  it("counts in words", () => {
    expect([0, 1, 4].map(usesText)).toEqual(["never used", "used once", "used 4 times"]);
  });
});
