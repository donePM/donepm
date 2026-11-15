import { describe, expect, it } from "vitest";
import { fail, fakeExec, fixture, ok } from "../../test-support/fake-exec.js";
import { detectClaude } from "./detect.js";

const found = {
  "which claude": ok("/Users/someone/.local/bin/claude\n"),
  "claude --version": ok("2.1.288 (Claude Code)\n"),
};

describe("detectClaude", () => {
  it("not installed when which fails", async () => {
    expect(await detectClaude(fakeExec({ "which claude": fail("", 1) }))).toEqual({ state: "not_installed" });
  });

  it("ready with path and version", async () => {
    const exec = fakeExec({ ...found, "claude auth status": ok(fixture("claude/auth-status-logged-in.json")) });
    expect(await detectClaude(exec)).toEqual({
      state: "ready",
      path: "/Users/someone/.local/bin/claude",
      version: "2.1.288",
    });
  });

  it("not logged in when loggedIn is false", async () => {
    const exec = fakeExec({
      ...found,
      "claude auth status": { code: 1, stdout: fixture("claude/auth-status-logged-out.json"), stderr: "" },
    });
    expect((await detectClaude(exec)).state).toBe("not_logged_in");
  });

  it("not logged in when auth status is not JSON (older CLI)", async () => {
    const exec = fakeExec({ ...found, "claude auth status": fail("error: unknown command 'auth'") });
    expect(await detectClaude(exec)).toEqual({
      state: "not_logged_in",
      path: "/Users/someone/.local/bin/claude",
      version: "2.1.288",
    });
  });
});
