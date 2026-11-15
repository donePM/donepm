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

describe("ghHint", () => {
  it("names a GitHub host other than github.com when logging in (issue #140)", () => {
    expect(ghHint("not_logged_in")).toMatchObject({ command: "gh auth login" });
    expect(ghHint("not_logged_in", "github.acme.com")).toMatchObject({ tone: "warn", command: "gh auth login --hostname github.acme.com" });
    expect(ghHint("ready", "github.acme.com")).toMatchObject({ tone: "ok" });
  });
});

describe("helperHint", () => {
  it("offers the install command only when missing", () => {
    expect(helperHint({ installed: true, path: "/bin/x" }, "npm i -g x")).toEqual({ label: "installed", tone: "ok" });
    expect(helperHint({ installed: false }, "npm i -g x")).toMatchObject({ label: "not installed", tone: "muted", command: "npm i -g x" });
  });
});
