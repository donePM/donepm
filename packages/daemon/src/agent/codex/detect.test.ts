import { describe, expect, it } from "vitest";
import { fail, fakeExec, ok } from "../../test-support/fake-exec.js";
import { detectCodex } from "./detect.js";

const found = {
  "which codex": ok("/opt/homebrew/bin/codex\n"),
  "codex --version": ok("codex-cli 0.133.0\n"),
};

describe("detectCodex", () => {
  it("not installed when which fails", async () => {
    expect(await detectCodex(fakeExec({ "which codex": fail("", 1) }))).toEqual({ state: "not_installed" });
  });

  it("ready with path and version when login status exits 0", async () => {
    const exec = fakeExec({ ...found, "codex login status": ok("Logged in\n") });
    expect(await detectCodex(exec)).toEqual({ state: "ready", path: "/opt/homebrew/bin/codex", version: "0.133.0" });
  });

  it("not logged in when login status fails", async () => {
    const exec = fakeExec({ ...found, "codex login status": fail("Not logged in", 1) });
    expect(await detectCodex(exec)).toEqual({ state: "not_logged_in", path: "/opt/homebrew/bin/codex", version: "0.133.0" });
  });

  it("asks only for the login status, never for the auth file", async () => {
    const exec = fakeExec({ ...found, "codex login status": ok("") });
    await detectCodex(exec);
    expect(exec.calls.map((c) => [c.cmd, ...c.args].join(" "))).toEqual(["which codex", "codex --version", "codex login status"]);
  });
});
