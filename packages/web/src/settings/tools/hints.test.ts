import { describe, expect, it } from "vitest";
import { ghHint, hintDot } from "./hints";

describe("hintDot", () => {
  it("is green when ready, amber when something needs fixing, grey while unknown", () => {
    expect(hintDot(ghHint("ready"))).toBe("ok");
    expect(hintDot(ghHint("not_installed"))).toBe("attn");
    expect(hintDot(undefined)).toBe("off");
  });
});
