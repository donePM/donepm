import { describe, expect, it } from "vitest";
import { issuePriority, priorityName, priorityTier, priorityTierOfField } from "./priority.js";

describe("priorityTierOfField", () => {
  it.each([
    ["Urgent", 0],
    ["Critical", 0],
    ["High", 1],
    ["Medium", 2],
    ["Normal", 2],
    ["Low", 3],
    ["low", 3],
    [" HIGH ", 1],
    ["P0", 0],
    ["p3", 3],
  ])("%j → %i", (option, tier) => expect(priorityTierOfField(option)).toBe(tier));

  it.each(["Someday", "P4", "", "Very high"])("does not know %j", (option) => expect(priorityTierOfField(option)).toBeUndefined());
});

describe("issuePriority", () => {
  it("prefers the issue field over the labels", () => {
    expect(issuePriority({ labels: ["P0"], priorityField: "Low" })).toBe(3);
  });

  it("falls back to the labels without a field or with an unknown option", () => {
    expect(issuePriority({ labels: ["P1"] })).toBe(1);
    expect(issuePriority({ labels: ["P1"], priorityField: "Someday" })).toBe(1);
    expect(issuePriority({ labels: [] })).toBe(2);
  });
});

describe("priorityName", () => {
  it("is P and the tier", () => expect(priorityName(1)).toBe("P1"));
});

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
