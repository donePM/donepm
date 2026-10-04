import { describe, expect, it } from "vitest";
import { ghHint, helperHint, hintDot } from "./hints";

describe("hintDot", () => {
  it("is green when ready, amber when something needs fixing, grey while unknown", () => {
    expect(hintDot(ghHint("ready"))).toBe("ok");
    expect(hintDot(ghHint("not_installed"))).toBe("attn");
    expect(hintDot(undefined)).toBe("off");
  });

  it("is grey for a missing helper, which is optional", () => {
    expect(hintDot(helperHint({ installed: false }, "npm i -g x"))).toBe("off");
    expect(hintDot(helperHint(undefined, "npm i -g x"))).toBe("off");
    expect(hintDot(helperHint({ installed: true }, "npm i -g x"))).toBe("ok");
  });
});

describe("helperHint", () => {
  it("offers the install command only when missing", () => {
    expect(helperHint({ installed: true, path: "/bin/x" }, "npm i -g x")).toEqual({ label: "installed", tone: "ok" });
    expect(helperHint({ installed: false }, "npm i -g x")).toMatchObject({ label: "not installed", tone: "muted", command: "npm i -g x" });
  });
});
