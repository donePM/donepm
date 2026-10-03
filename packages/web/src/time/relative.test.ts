import { describe, expect, it } from "vitest";
import { ago } from "./relative";

const at = Date.parse("2026-10-03T12:00:00Z");

describe("ago", () => {
  it.each([
    ["2026-10-03T11:59:48Z", "12 s ago"],
    ["2026-10-03T11:57:00Z", "3 min ago"],
    ["2026-10-03T10:00:00Z", "2 h ago"],
    ["2026-09-29T12:00:00Z", "4 d ago"],
  ])("%s → %s", (iso, text) => expect(ago(iso, at)).toBe(text));

  it("clamps clock skew to 0 s", () => expect(ago("2026-10-03T12:00:05Z", at)).toBe("0 s ago"));
});
