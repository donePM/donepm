import { describe, expect, it } from "vitest";
import { agentElapsed, clock, money } from "./duration";

describe("clock", () => {
  it("shows minutes and seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(42_900)).toBe("0:42");
    expect(clock(372_000)).toBe("6:12");
  });

  it("adds hours when needed", () => {
    expect(clock(3_723_000)).toBe("1:02:03");
  });

  it("never goes negative", () => {
    expect(clock(-5000)).toBe("0:00");
  });
});

describe("money", () => {
  it("shows dollars with cents", () => {
    expect(money(0.4123)).toBe("$0.41");
    expect(money(2)).toBe("$2.00");
  });
});

describe("agentElapsed", () => {
  const now = Date.parse("2026-10-04T09:10:00Z");
  it("adds the running interval to the closed ones", () => {
    expect(agentElapsed({ elapsedMs: 180_000, activeSince: "2026-10-04T09:08:00Z" }, now)).toBe(300_000);
    expect(agentElapsed({ elapsedMs: 180_000 }, now)).toBe(180_000);
  });

  it("is undefined before the agent ran", () => {
    expect(agentElapsed({}, now)).toBeUndefined();
  });
});
