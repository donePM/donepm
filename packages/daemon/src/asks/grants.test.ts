import { describe, expect, it } from "vitest";
import { openDb } from "../db/database.js";
import { GrantStore } from "./grants.js";

const at = "2026-10-04T10:00:00.000Z";
const rule = { toolName: "Bash", ruleContent: "pnpm test *" };
const grant = (id: string, repo = "github.com/o/r", r: { toolName: string; ruleContent?: string } = rule) => ({
  id, repo, rule: r, askId: "ask-1", itemId: "item-1", call: "Bash: pnpm test",
});

describe("GrantStore", () => {
  it("stores a grant per repository and rule", () => {
    const s = new GrantStore(openDb(":memory:"));
    expect(s.add(grant("g1"), at)).toEqual({
      id: "g1", repo: "github.com/o/r", toolName: "Bash", ruleContent: "pnpm test *", createdAt: at,
      askId: "ask-1", itemId: "item-1", call: "Bash: pnpm test", useCount: 0,
    });
    expect(s.add(grant("g2"), at)).toBeUndefined();
    expect(s.add(grant("g3", "github.com/o/other"), at)).toBeDefined();
    expect(s.add(grant("g4", "github.com/o/r", { toolName: "Read" }), at)).toMatchObject({ toolName: "Read" });
    expect(s.get("g4")).not.toHaveProperty("ruleContent");
    expect(s.active("github.com/o/r").map((g) => g.id)).toEqual(["g1", "g4"]);
    expect(s.active().map((g) => g.id)).toEqual(["g3", "g1", "g4"]);
  });

  it("counts uses", () => {
    const s = new GrantStore(openDb(":memory:"));
    s.add(grant("g1"), at);
    s.used(["g1"], "2026-10-04T11:00:00.000Z");
    s.used(["g1"], "2026-10-04T12:00:00.000Z");
    expect(s.get("g1")).toMatchObject({ useCount: 2, lastUsedAt: "2026-10-04T12:00:00.000Z" });
  });

  it("keeps a removed grant but stops listing it, and allows granting the rule again", () => {
    const s = new GrantStore(openDb(":memory:"));
    s.add(grant("g1"), at);
    expect(s.revoke("g1", "2026-10-04T11:00:00.000Z")).toBe(true);
    expect(s.revoke("g1", "2026-10-04T12:00:00.000Z")).toBe(false);
    expect(s.get("g1")!.revokedAt).toBe("2026-10-04T11:00:00.000Z");
    expect(s.active()).toEqual([]);
    expect(s.add(grant("g2"), at)).toBeDefined();
  });

  it("outlives the item and ask it was granted on", () => {
    const s = new GrantStore(openDb(":memory:"));
    expect(s.add({ ...grant("g1"), askId: "gone", itemId: "gone" }, at)).toBeDefined();
  });
});
