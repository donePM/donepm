import { describe, expect, it } from "vitest";
import { priorityTier } from "./priority.js";

describe("priorityTier", () => {
  it.each([
    ["P0", 0],
    ["priority: critical", 0],
    ["P1", 1],
    ["priority: high", 1],
    ["P2", 2],
    ["priority: medium", 2],
    ["P3", 3],
    ["priority: low", 3],
  ])("%s → %i", (label, tier) => expect(priorityTier([label])).toBe(tier));

  it.each(["p1", "Priority: High", "PRIORITY: HIGH", "priority:high", "priority/high", "prio: high", "prio:high", "priority / high", " P1 "])(
    "reads %j as tier 1",
    (label) => expect(priorityTier([label])).toBe(1),
  );

  it("is 2 without a priority label", () => {
    expect(priorityTier([])).toBe(2);
    expect(priorityTier(["bug", "enhancement"])).toBe(2);
  });

  it.each(["P4", "P", "P10", "priority: urgent", "priority", "high", "low priority", "type: P1", "xp1"])(
    "ignores %j",
    (label) => expect(priorityTier([label])).toBe(2),
  );

  it("takes the most urgent of several priority labels", () => {
    expect(priorityTier(["priority: low", "P1", "bug"])).toBe(1);
    expect(priorityTier(["P3", "priority: critical"])).toBe(0);
    expect(priorityTier(["P3", "P2"])).toBe(2);
  });

  it("lets a lower tier win over the default", () => {
    expect(priorityTier(["P3"])).toBe(3);
  });
});
