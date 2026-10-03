import { describe, expect, it } from "vitest";
import { clock, money } from "./duration";

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
