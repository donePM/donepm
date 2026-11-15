import { describe, expect, it } from "vitest";
import { fail, fakeExec, ok } from "../test-support/fake-exec.js";
import { detectHelper, detectHelpers } from "./detect.js";

describe("detectHelper", () => {
  it("is not installed when which fails, and runs nothing else", async () => {
    const exec = fakeExec({ "which playwright-cli": fail("", 1) });
    expect(await detectHelper(exec, "playwright-cli")).toEqual({ installed: false });
    expect(exec.calls).toHaveLength(1);
  });

  it("reports path and version", async () => {
    const exec = fakeExec({
      "which playwright-cli": ok("/opt/homebrew/bin/playwright-cli\n"),
      "playwright-cli --version": ok("0.1.1\n"),
    });
    expect(await detectHelper(exec, "playwright-cli")).toEqual({ installed: true, path: "/opt/homebrew/bin/playwright-cli", version: "0.1.1" });
  });

  it("reads the version past an update notice", async () => {
    const banner = [
      "╔══════════════════════════════════════════════════════╗",
      "║ Update available for @playwright/cli: 0.1.18 → 0.1.22 ║",
      "╚══════════════════════════════════════════════════════╝",
      "",
      "0.1.18",
      "",
    ].join("\n");
    const exec = fakeExec({ "which playwright-cli": ok("/bin/playwright-cli\n"), "playwright-cli --version": ok(banner) });
    expect((await detectHelper(exec, "playwright-cli")).version).toBe("0.1.18");
  });

  it("is installed without a version when --version fails", async () => {
    const exec = fakeExec({ "which playwright-cli": ok("/usr/local/bin/playwright-cli\n"), "playwright-cli --version": fail("unknown option", 2) });
    expect(await detectHelper(exec, "playwright-cli")).toEqual({ installed: true, path: "/usr/local/bin/playwright-cli" });
  });
});

describe("detectHelpers", () => {
  it("keys every helper by its id", async () => {
    const exec = fakeExec({ "which playwright-cli": ok("/bin/playwright-cli\n"), "playwright-cli --version": ok("Version 1.2.3\n") });
    expect(await detectHelpers(exec)).toEqual({ "playwright-cli": { installed: true, path: "/bin/playwright-cli", version: "1.2.3" } });
  });
});
