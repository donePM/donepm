import { describe, expect, it } from "vitest";
import { bytes, uptime } from "./format";

describe("bytes", () => {
  it("uses powers of 1024 with one decimal below 10", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(34 * 1024)).toBe("34 KB");
    expect(bytes(2.1 * 1024 ** 3)).toBe("2.1 GB");
    expect(bytes(0)).toBe("0 B");
  });
});

describe("uptime", () => {
  const start = "2026-10-01T00:00:00.000Z";
  const at = (s: number) => Date.parse(start) + s * 1000;

  it("is coarse: seconds, minutes, hours with minutes, days with hours", () => {
    expect(uptime(start, at(42))).toBe("42 s");
    expect(uptime(start, at(12 * 60))).toBe("12 min");
    expect(uptime(start, at(3 * 3600 + 5 * 60))).toBe("3 h 5 min");
    expect(uptime(start, at(3 * 3600))).toBe("3 h");
    expect(uptime(start, at(2 * 86400 + 4 * 3600))).toBe("2 d 4 h");
  });
});
