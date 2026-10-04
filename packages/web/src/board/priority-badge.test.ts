import { describe, expect, it } from "vitest";
import { priorityBadge } from "./priority-badge";

describe("priorityBadge", () => {
  it("shows nothing for the default tier", () => {
    expect(priorityBadge(2)).toBeUndefined();
  });

  it.each([
    [0, "P0", "urgent"],
    [1, "P1", "urgent"],
    [3, "P3", "low"],
  ])("shows tier %i as %s (%s)", (tier, text, tone) => {
    expect(priorityBadge(tier)).toMatchObject({ text, tone });
  });
});
